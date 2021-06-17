// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExtensionType, ExtensionState, Extension, ExtensionManager,
       extractExtension, loadExtension, releaseCompatible, versionCompatible */

const ByteArray = imports.byteArray;
const {GLib, Gio, GObject} = imports.gi;

const {Exec, File} = imports.utils;


/*
 * Internal Constants
 */
const EXTENSIONS_PATH = GLib.build_filenamev([GLib.get_user_data_dir(),
    'gnome-shell', 'extensions']);
const EXTENSION_UPDATES_PATH = GLib.build_filenamev([GLib.get_user_data_dir(),
    'gnome-shell', 'extension-updates']);


/**
 * Enumeration of extension states.
 *
 * @readonly
 * @enum {string}
 */
var ExtensionState = {
    /** The extension is enabled */
    ENABLED: 1,
    /** The extension is disabled */
    DISABLED: 2,
    /** The extension encountered an error */
    ERROR: 3,
    /** The extension is out of date */
    OUT_OF_DATE: 4,
    /** The extension is downloading */
    DOWNLOADING: 5,
    /** The extension is initialized */
    INITIALIZED: 6,
    /** The extension is not installed */
    UNINSTALLED: 99,
};


/**
 * Enumeration of extension types.
 *
 * @readonly
 * @enum {string}
 */
var ExtensionType = {
    SYSTEM: 1,
    USER: 2,
};


/**
 * Load extension metadata from @dir
 *
 * @param {Gio.File} dir - the directory
 * @param {Gio.Cancellable} [cancellable] - optional cancellable
 * @return {Object} extension metadata
 */
async function loadExtension(dir, cancellable = null) {
    if (typeof dir === 'string')
        dir = Gio.File.new_for_path(dir);

    // Check for `extension.js`
    const extensionFile = dir.get_child('extension.js');

    if (!extensionFile.query_exists(cancellable)) {
        throw new Gio.IOErrorEnum({
            code: Gio.IOErrorEnum.NOT_FOUND,
            message: 'missing "extension.js"',
        });
    }

    // Check for `metadata.json`
    const metadataFile = dir.get_child('metadata.json');

    if (!metadataFile.query_exists(cancellable)) {
        throw new Gio.IOErrorEnum({
            code: Gio.IOErrorEnum.NOT_FOUND,
            message: 'missing "metadata.json"',
        });
    }

    // Try to load and parse the `metadata.json`
    const metadata = await new Promise((resolve, reject) => {
        metadataFile.load_contents_async(cancellable, (_file, result) => {
            try {
                const contents = _file.load_contents_finish(result)[1];
                const json = ByteArray.toString(contents);

                resolve(JSON.parse(json));
            } catch (e) {
                reject(e);
            }
        });
    });

    // Minimum required properties
    const required = ['uuid', 'name', 'description', 'shell-version'];

    for (const name of required) {
        if (!metadata.hasOwnProperty(name))
            throw ReferenceError(`metadata.json: missing "${name}" property`);
    }

    // Add properties usually received over DBus
    metadata.state = ExtensionState.UNINSTALLED;
    metadata.type = ExtensionType.USER;
    metadata.path = dir.get_path();
    metadata.error = '';
    metadata.hasPrefs = dir.get_child('prefs.js').query_exists(null);
    metadata.hasUpdate = false;
    metadata.canChange = true;

    return metadata;
}


/**
 * Extract extension metadata from @zip.
 *
 * If @dest is not given the extension will be extracted to a temporary
 * directory. The resulting metadata key `path` will always point to @dest.
 *
 * @param {Gio.File} zip - the extension ZIP file
 * @param {Gio.File} [dest] - the destination directory, defaults to in-memory
 * @param {Gio.Cancellable} [cancellable] - optional cancellable
 * @return {Object} extension metadata
 */
async function extractExtension(zip, dest = null, cancellable = null) {
    if (dest === null) {
        dest = GLib.Dir.make_tmp('XXXXXX.annex');
        dest = Gio.File.new_for_path(dest);
    }

    await Exec.communicate([
        GLib.find_program_in_path('unzip'),
        '-u',                  // Update
        '-o',                  // Overwrite
        '-d', dest.get_path(), // Target directory
        zip.get_path(),        // Source archive
    ], null, cancellable);

    return loadExtension(dest, cancellable);
}


/**
 * Returns %true if @version is compatible with @shellVersion.
 *
 * @param {string} version - an extension's supported GNOME Shell version
 * @param {string} [shellVersion] - a GNOME Shell version or "all"
 * @return {boolean} %true if compatible
 */
function versionCompatible(version, shellVersion = 'all') {
    if (shellVersion === 'all')
        return true;

    const [major, minor] = version.split('.');
    const [shellMajor, shellMinor] = shellVersion.split('.');

    if (shellMajor !== major)
        return false;

    if (shellMinor !== minor && shellMajor < 40)
        return false;

    return true;
}


/**
 * Returns %true if @release is compatible with @shellVersion.
 *
 * @release may be really any Object which has a `shell_version` field that is
 * a list of GNOME Shell versions in string form.
 *
 * @param {Object} release - an Object with a `shell_version` property
 * @param {string[]} release.shell_version - a list of GNOME Shell versions
 * @param {string} [shellVersion] - a GNOME Shell version or "all"
 * @return {boolean} %true if compatible
 */
function releaseCompatible(release, shellVersion = 'all') {
    if (shellVersion === 'all')
        return true;

    // Sort the haystack to check the releases from newest to oldest
    const versions = release.shell_version.sort((a, b) => {
        return Math.ceil(parseFloat(b) - parseFloat(a));
    });

    // Return %true for the first compatible version
    for (const version of versions) {
        if (versionCompatible(version, shellVersion))
            return true;
    }

    return false;
}


/**
 * An object representing a GNOME Shell extension.
 *
 * Usually an instance of this class represents an installed extension, but it
 * may also have been created from a Zip file or folder.
 */
var Extension = GObject.registerClass({
    GTypeName: 'AnnexShellExtension',
    Properties: {
        'description': GObject.ParamSpec.string(
            'description',
            'Description',
            'Description of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'can-change': GObject.ParamSpec.boolean(
            'can-change',
            'Can Change',
            'Whether the extension can be removed',
            GObject.ParamFlags.READWRITE,
            false
        ),
        'error': GObject.ParamSpec.string(
            'error',
            'Error',
            'Error message',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'has-prefs': GObject.ParamSpec.boolean(
            'has-prefs',
            'Has Prefs',
            'Whether the extension has preferences',
            GObject.ParamFlags.READWRITE,
            false
        ),
        'has-update': GObject.ParamSpec.boolean(
            'has-update',
            'Has Update',
            'Whether the extension has an update pending',
            GObject.ParamFlags.READWRITE,
            false
        ),
        'name': GObject.ParamSpec.string(
            'name',
            'Name',
            'Name of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'path': GObject.ParamSpec.string(
            'path',
            'Path',
            'Path of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'state': GObject.ParamSpec.uint(
            'state',
            'State',
            'State of the extension',
            GObject.ParamFlags.READWRITE,
            ExtensionState.ENABLED, ExtensionState.UNINSTALLED,
            ExtensionState.UNINSTALLED
        ),
        'type': GObject.ParamSpec.uint(
            'type',
            'Type',
            'Type of the extension',
            GObject.ParamFlags.READWRITE,
            ExtensionType.SYSTEM, ExtensionType.USER,
            ExtensionType.USER
        ),
        'url': GObject.ParamSpec.string(
            'url',
            'URL',
            'URL of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'uuid': GObject.ParamSpec.string(
            'uuid',
            'UUID',
            'UUID of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'version': GObject.ParamSpec.uint(
            'version',
            'Version',
            'Version of the extension',
            GObject.ParamFlags.READWRITE,
            1, GLib.MAXUINT32,
            1
        ),
    },
}, class AnnexShellExtension extends GObject.Object {
    _init(params = {}) {
        super._init();

        this.updateState(params);
    }

    get shell_version() {
        if (this['shell-version'] === undefined)
            this['shell-version'] = [];

        return this['shell-version'];
    }

    /**
     * Check if the extension supports @shellVersion.
     *
     * @param {string} shellVersion - a GNOME Shell version string
     * @return {boolean} %true if supported
     */
    checkVersion(shellVersion) {
        const versions = this.shell_version.sort((a, b) => {
            return Math.ceil(parseFloat(b) - parseFloat(a));
        });

        for (const version of versions) {
            if (versionCompatible(shellVersion, version))
                return true;
        }

        return false;
    }

    /**
     * Update the extension state with @properties.
     *
     * @param {Obeject} properties - Extension properties
     */
    updateState(properties = {}) {
        try {
            Object.assign(this, properties);
        } catch (e) {
            warning(e);
        }
    }
});


/**
 * A proxy for the org.gnome.Shell.Extensions interface
 */
var ExtensionManager = GObject.registerClass({
    GTypeName: 'AnnexShellExtensionManager',
    Properties: {
        'shell-version': GObject.ParamSpec.string(
            'shell-version',
            'Shel Version',
            'The running shell version',
            GObject.ParamFlags.READABLE,
            null
        ),
        'user-extensions-enabled': GObject.ParamSpec.boolean(
            'user-extensions-enabled',
            'User extensions enabled',
            'Whether user extensions are enabled',
            GObject.ParamFlags.READWRITE,
            true
        ),
    },
    Signals: {
        'extension-added': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING, // Extension UUID
                Extension.$gtype,    // Extension Info
            ],
        },
        'extension-removed': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [
                GObject.TYPE_STRING, // Extension UUID
                Extension.$gtype,    // Extension Info
            ],
        },
    },
}, class AnnexShellExtensionManager extends Gio.DBusProxy {
    _init() {
        super._init({
            g_bus_type: Gio.BusType.SESSION,
            g_name: 'org.gnome.Shell',
            g_object_path: '/org/gnome/Shell',
            g_interface_name: 'org.gnome.Shell.Extensions',
        });

        this.connect('notify::g-name-owner',
            this._onNameOwnerChanged.bind(this));

        this.connect('g-properties-changed',
            this._onPropertiesChanged.bind(this));

        this.connect('g-signal',
            this._onSignal.bind(this));

        this._extensions = new Map();
    }

    on_extension_added(uuid, extension) {
        debug(uuid);
        this._extensions.set(extension.uuid, extension);
    }

    on_extension_removed(uuid, extension) {
        debug(uuid);
        this._extensions.delete(extension.uuid);
    }

    static getDefault() {
        if (this.__default === undefined) {
            this.__default = new ExtensionManager();
            this.__default.init(null);
            this.__default.refresh();
        }

        return this.__default;
    }

    /*
     * GDBusProxy
     */
    _onNameOwnerChanged() {
        this.refresh();
    }

    _onPropertiesChanged(proxy, changed, _invalidated) {
        const names = changed.deepUnpack();

        if (names.hasOwnProperty('ShellVersion'))
            this.notify('shell-version');

        if (names.hasOwnProperty('UserExtensionsEnabled'))
            this.notify('user-extensions-enabled');
    }

    _onSignal(proxy, senderName, signalName, parameters) {
        const unpacked = parameters.recursiveUnpack();

        if (signalName === 'ExtensionStateChanged') {
            const [uuid, properties] = unpacked;
            let extension = this._extensions.get(uuid);

            if (extension === undefined) {
                extension = new Extension(properties);
                this.emit('extension-added', extension.uuid, extension);
            } else {
                extension.updateState(properties);
            }

            if (extension.state === ExtensionState.UNINSTALLED)
                this.emit('extension-removed', extension.uuid, extension);
        }

        if (signalName === 'ExtensionStatusChanged') {
            const [uuid, state, message_] = unpacked;

            if (state === ExtensionState.UNINSTALLED) {
                const extension = this._extensions.get(uuid);

                if (extension !== undefined)
                    this.emit('extension-removed', extension.uuid, extension);
            }
        }
    }

    _call(name, parameters = null, cancellable = null) {
        return new Promise((resolve, reject) => {
            this.call(
                name,
                parameters,
                Gio.DBusCallFlags.NO_AUTO_START,
                -1,
                cancellable,
                (proxy, result) => {
                    try {
                        const reply = proxy.call_finish(result);

                        if (reply.n_children() === 0) {
                            resolve();
                        } else {
                            const value = reply.get_child_value(0);
                            resolve(value.recursiveUnpack());
                        }
                    } catch (e) {
                        if (e instanceof Gio.DBusError)
                            Gio.DBusError.strip_remote_error(e);

                        reject(e);
                    }
                }
            );
        });
    }

    _get(name, fallback = null) {
        try {
            return this.get_cached_property(name).unpack();
        } catch (e) {
            return fallback;
        }
    }

    _set(name, value) {
        this.call(
            'org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [this.g_interface_name, name, value]),
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (e) {
                    if (e instanceof Gio.DBusError)
                        Gio.DBusError.strip_remote_error(e);

                    logError(e);
                }
            }
        );
    }

    /*
     * Internal methods
     */
    async _loadDirectory(path, cancellable = null) {
        const results = [];
        const dir = Gio.File.new_for_path(path);

        const iter = dir.enumerate_children('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable);

        let info;

        while ((info = iter.next_file(cancellable))) {
            try {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                    continue;

                const subdir = iter.get_child(info);
                const properties = await loadExtension(subdir);

                if (properties.uuid === subdir.get_basename())
                    results.push(properties);
            } catch (e) {
                warning(e, info.get_name());
            }
        }

        return results;
    }

    /*
     * org.gnome.Shell.Extensions
     */
    get shell_version() {
        return this._get('ShellVersion', 'all');
    }

    get user_extensions_enabled() {
        return this._get('UserExtensionsEnabled', false);
    }

    set user_extensions_enabled(enabled) {
        this._set('UserExtensionsEnabled', GLib.Variant.new_boolean(enabled));
    }

    /**
     * Disable an extension.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<boolean>} success boolean
     */
    disableExtension(uuid, cancellable = null) {
        return this._call('DisableExtension', new GLib.Variant('(s)', [uuid]),
            cancellable);
    }

    /**
     * Enable an extension.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<boolean>} success boolean
     */
    enableExtension(uuid, cancellable = null) {
        return this._call('EnableExtension', new GLib.Variant('(s)', [uuid]),
            cancellable);
    }

    /**
     * Install an extension from extensions.gnome.org.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<string>} result message
     */
    installExtension(uuid, cancellable = null) {
        return this._call('InstallRemoteExtension',
            new GLib.Variant('(s)', [uuid]), cancellable);
    }

    /**
     * Install an extension from @zip. If the extension @uuid is already
     * installed, @zip will be queued as an update for the next session.
     *
     * @param {Gio.File} zip - an extension ZIP
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<string>} result message
     */
    async installExtensionFile(zip, cancellable = null) {
        // Extract and load the ZIP
        const info = await extractExtension(zip, null, cancellable);
        const src = Gio.File.new_for_path(info.path);

        // If already installed, stage the ZIP as an update
        let path = GLib.build_filenamev([EXTENSIONS_PATH, info.uuid]);

        if (this._extensions.has(info.uuid))
            path = GLib.build_filenamev([EXTENSION_UPDATES_PATH, info.uuid]);

        // Ensure we have a clean directory
        const dest = Gio.File.new_for_path(path);

        if (dest.query_exists(cancellable))
            await File.recursiveDelete(dest, cancellable);

        dest.make_directory_with_parents(cancellable);

        // Copy to the target
        await File.recursiveMove(src, dest, cancellable);

        this.refresh();
    }

    /**
     * Lookup an extension for @uuid.
     *
     * @param {string} uuid - an extension UUID
     * @return {Shell.Extension|null} an extension or %null if not found
     */
    lookup(uuid) {
        const extension = this._extensions.get(uuid);

        if (extension instanceof Extension)
            return extension;

        return null;
    }

    /**
     * Lookup a pending update for @uuid.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Shell.Extension|null} an extension or %null if not found
     */
    async lookupPending(uuid, cancellable = null) {
        let extension = null;

        try {
            const path = GLib.build_filenamev([EXTENSION_UPDATES_PATH, uuid]);
            const properties = await loadExtension(path, cancellable);

            if (properties.uuid === uuid)
                extension = new Extension(properties);
        } catch (e) {
            debug(e);
        }

        return extension;
    }

    /**
     * List installed extensions.
     *
     * @return {Shell.Extension[]} a list of Shell.Extension objects
     */
    listExtensions() {
        return this._extensions.values();
    }

    /**
     * Uninstall an extension from the local device.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<string>} result
     */
    async uninstallExtension(uuid, cancellable = null) {
        // Uninstall the extension
        try {
            await this._call('UninstallExtension',
                new GLib.Variant('(s)', [uuid]), cancellable);
        } catch (e) {
            warning(e, uuid);
        }

        // Remove any unmanaged files
        const tasks = [];

        for (const basepath of [EXTENSIONS_PATH, EXTENSION_UPDATES_PATH]) {
            const path = GLib.build_filenamev([basepath, uuid]);
            const task = File.recursiveDelete(path).then(warning);

            tasks.push(task);
        }

        await Promise.all(tasks);

        // Ensure we stop managing the extension object
        const extension = this._extensions.get(uuid);

        if (extension !== undefined)
            this.emit('extension-removed', extension.uuid, extension);
    }

    /**
     * Open the preferences window for an extension.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise} operation object
     */
    launchExtensionPrefs(uuid, cancellable = null) {
        return this._call('LaunchExtensionPrefs',
            new GLib.Variant('(s)', [uuid]), cancellable);
    }

    /**
     * Rescan the DBus service, user extensions directory and pending updates
     * directory for changes.
     */
    async refresh() {
        const scanned = {};

        // Query the DBus service
        try {
            const results = await this._call('ListExtensions');

            for (const properties of Object.values(results))
                scanned[properties.uuid] = properties;
        } catch (e) {
            warning(e);
        }

        // Check the user directory and mark extensions unknown to the DBus
        // service as pending updates.
        try {
            const results = await this._loadDirectory(EXTENSIONS_PATH);

            for (const properties of results) {
                if (!scanned.hasOwnProperty(properties.uuid)) {
                    scanned[properties.uuid] = properties;
                    scanned[properties.uuid].hasUpdate = true;
                }
            }
        } catch (e) {
            warning(e);
        }

        // Check the updates directory for untracked pending updates
        try {
            const results = await this._loadDirectory(EXTENSION_UPDATES_PATH);

            for (const properties of results) {
                const extension = scanned[properties.uuid];

                if (extension !== undefined)
                    extension.has_update = true;
            }
        } catch (e) {
            warning(e);
        }

        // Notify removals & additions
        for (const [uuid, extension] of this._extensions) {
            if (scanned.hasOwnProperty(uuid))
                continue;

            this.emit('extension-removed', extension.uuid, extension);
        }

        for (const [uuid, properties] of Object.entries(scanned)) {
            let extension = this._extensions.get(uuid);

            if (extension === undefined) {
                extension = new Extension(properties);
                this.emit('extension-added', extension.uuid, extension);
            } else {
                extension.updateState(properties);
            }
        }
    }
});

