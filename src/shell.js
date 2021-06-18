// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExtensionType, ExtensionState, Extension, ExtensionManager,
       loadExtension, releaseCompatible, versionCompatible */

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
 * Enumeration of extension states. The majority of these are used by GNOME
 * Shell, except where noted.
 *
 * @readonly
 * @enum {string}
 */
var ExtensionState = {
    /**
     * The extension is enabled. This implies the extension is installed and
     * initialized, with no errors.
     */
    ENABLED: 1,
    /**
     * The extension is disabled. This implies the extension is installed and
     * initialized, with no errors.
     */
    DISABLED: 2,
    /**
     * The extension encountered an error. When an extension holds this state,
     * the `error` property will hold an error message.
     */
    ERROR: 3,
    /**
     * The extension is out of date. This is a special error that occurs when an
     * installed extension does not support the current GNOME Shell version.
     */
    OUT_OF_DATE: 4,
    /**
     * The extension is downloading. This state is used by the shell when
     * installing a remote extension from extensions.gnome.org.
     */
    DOWNLOADING: 5,
    /**
     * The extension is initialized. This state is set by the shell after an
     * extension's `init()` method has been invoked.
     */
    INITIALIZED: 6,
    /**
     * Non-standard: The extension is not initialized. This is used when an
     * extension has been installed, but will not be loaded until next login.
     */
    UNINITIALIZED: 98,
    /**
     * The extension is not installed. This is not usually used by GNOME Shell,
     * but Annex uses it for Zip files and other uninstalled extension sources.
     */
    UNINSTALLED: 99,
};


/**
 * Enumeration of extension types.
 *
 * @readonly
 * @enum {string}
 */
var ExtensionType = {
    /**
     * A system extension, usually installed from a package manager.
     */
    SYSTEM: 1,
    /**
     * A user extension, usually installed from extensions.gnome.org or a Zip.
     */
    USER: 2,
};


/**
 * Extract @zip to @dest and return @dest on success. If @dest is not given @zip
 * will be extracted to a temporary directory.
 *
 * @param {Gio.File} zip - the extension ZIP file
 * @param {Gio.File} [dest] - the destination directory
 * @param {Gio.Cancellable} [cancellable] - optional cancellable
 * @return {Gio.File} the destination directory
 */
async function extractZip(zip, dest = null, cancellable = null) {
    if (dest === null) {
        const path = GLib.Dir.make_tmp('XXXXXX.annex');
        dest = Gio.File.new_for_path(path);
    }

    // Spawn the process
    const proc = new Gio.Subprocess({
        argv: [
            GLib.find_program_in_path('unzip'),
            '-u',                  // Update
            '-o',                  // Overwrite
            '-d', dest.get_path(), // Target directory
            zip.get_path(),        // Source archive
        ],
        flags: Gio.SubprocessFlags.STDOUT_SILENCE |
            Gio.SubprocessFlags.STDERR_PIPE,
    });
    proc.init(cancellable);

    // Connect the cancellable
    let cancelId = 0;

    if (cancellable instanceof Gio.Cancellable)
        cancelId = cancellable.connect(() => proc.force_exit());

    // On success return the destination as a GFile
    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(null, null, (_proc, res) => {
            try {
                const [_ok, _stdout, stderr] = proc.communicate_utf8_finish(res);
                const status = proc.get_exit_status();

                if (status !== 0) {
                    throw new Gio.IOErrorEnum({
                        code: Gio.io_error_from_errno(status),
                        message: stderr ? stderr.trim() : GLib.strerror(status),
                    });
                }

                resolve(dest);
            } catch (e) {
                reject(e);
            } finally {
                if (cancelId > 0)
                    cancellable.disconnect(cancelId);
            }
        });
    });
}


/**
 * Attempt to load extension metadata from @file.
 *
 * If @file is a Zip file, it will be transparently extracted to a temporary
 * directory before being scanned.
 *
 * @param {Gio.File} file - a Zip file or directory
 * @param {Gio.Cancellable} [cancellable] - optional cancellable
 * @return {Object} extension metadata
 */
async function loadExtension(file, cancellable = null) {
    if (typeof file === 'string')
        file = Gio.File.new_for_path(file);

    const info = await new Promise((resolve, reject) => {
        file.query_info_async(
            'standard::type',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_file, result) => {
                try {
                    resolve(_file.query_info_finish(result));
                } catch (e) {
                    reject(e);
                }
            }
        );
    });

    // If we're passed a regular file, assume it's a Zip file
    if (info.get_file_type() === Gio.FileType.REGULAR)
        file = await extractZip(file, null, cancellable);

    // Check for `extension.js`
    const extensionFile = file.get_child('extension.js');

    if (!extensionFile.query_exists(cancellable)) {
        throw new Gio.IOErrorEnum({
            code: Gio.IOErrorEnum.NOT_FOUND,
            message: 'missing "extension.js"',
        });
    }

    // Check for `metadata.json`
    const metadataFile = file.get_child('metadata.json');

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
                const byteArray = _file.load_contents_finish(result)[1];
                const contents = ByteArray.toString(byteArray);

                resolve(JSON.parse(contents));
            } catch (e) {
                reject(e);
            }
        });
    });

    // Ensure minimum required properties
    const required = ['uuid', 'name', 'description', 'shell-version'];

    for (const name of required) {
        if (!metadata.hasOwnProperty(name))
            throw ReferenceError(`metadata.json: missing "${name}" property`);
    }

    // Pre-set this property for caller's that need access to the files
    metadata.path = file.get_path();

    return metadata;
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
        const metadata = await loadExtension(zip, cancellable);
        const src = Gio.File.new_for_path(metadata.path);

        // If already installed, stage the ZIP as an update
        let path = GLib.build_filenamev([EXTENSIONS_PATH, metadata.uuid]);

        if (this._extensions.has(metadata.uuid))
            path = GLib.build_filenamev([EXTENSION_UPDATES_PATH, metadata.uuid]);

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

