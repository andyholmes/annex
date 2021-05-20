// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExtensionType, ExtensionState, Extension, ExtensionManager */


const {GLib, Gio, GObject} = imports.gi;


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
 * Enumeration of extension states.
 *
 * @readonly
 * @enum {string}
 */
var ExtensionState = {
    ENABLED: 1,
    DISABLED: 2,
    ERROR: 3,
    OUT_OF_DATE: 4,
    DOWNLOADING: 5,
    INITIALIZED: 6,
    UNINSTALLED: 99,
};


/**
 * An object representing an installed extension.
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
            'Whether the extension has an update available',
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

        this.update(params);
    }

    /**
     * Update the extension with @properties.
     *
     * @param {Obeject} properties - Extension properties
     */
    update(properties = {}) {
        try {
            Object.assign(this, properties);
        } catch (e) {
            logError(e);
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
            param_types: [
                GObject.TYPE_STRING, // Extension UUID
                Extension.$gtype,    // Extension Info
            ],
        },
        'extension-removed': {
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

    static getDefault() {
        if (this.__default === undefined) {
            this.__default = new ExtensionManager();
            this.__default.init(null);
            this.__default._load();
        }

        return this.__default;
    }

    async _load() {
        try {
            const extensions = await this._call('ListExtensions');

            for (const [uuid, extension] of this._extensions) {
                if (extensions.hasOwnProperty(uuid))
                    continue;

                this._extensions.delete(uuid);
                this.emit('extension-removed', extension.uuid, extension);
            }

            for (const [uuid, properties] of Object.entries(extensions)) {
                let extension = this._extensions.get(uuid);

                if (extension === undefined) {
                    extension = new Extension(properties);

                    this._extensions.set(uuid, extension);
                    this.emit('extension-added', extension.uuid, extension);
                } else {
                    extension.update(properties);
                }
            }
        } catch (e) {
            logError(e);
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
                        const value = reply.get_child_value(0);

                        resolve(value.recursiveUnpack());
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
        this.set_cached_property(name, value);

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

    _onNameOwnerChanged() {
        this._load();
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

        // log(`${signalName}: ${JSON.stringify(unpacked, null, 2)}`);

        if (signalName === 'ExtensionStateChanged') {
            const [uuid, properties] = unpacked;
            let extension = this._extensions.get(uuid);

            if (extension === undefined) {
                extension = new Extension(properties);

                this._extensions.set(extension.uuid, extension);
                this.emit('extension-added', extension.uuid, extension);
            } else {
                extension.update(properties);
            }
        }

        if (signalName === 'ExtensionStatusChanged') {
            const [uuid, state, message_] = unpacked;

            if (state === ExtensionState.UNINSTALLED) {
                const extension = this._extensions.get(uuid);

                if (extension !== undefined) {
                    this._extensions.delete(uuid);
                    this.emit('extension-removed', extension.uuid, extension);
                }
            }
        }
    }

    get shell_version() {
        return this._get('ShellVersion', 'all');
    }

    get user_extensions_enabled() {
        return this._get('UserExtensionsEnabled', false);
    }

    set user_extensions_enabled(enabled) {
        this._set('UserExtensionsEnabled', GLib.Variant.new_boolean(enabled));
    }

    getExtensions() {
        return this._extensions.values();
    }

    async lookupExtension(uuid) {
        let extension = this._extensions.get(uuid);

        if (extension === undefined) {
            try {
                const properties = await this._call('GetExtensionInfo',
                    new GLib.Variant('(s)', [uuid]));

                if (properties.hasOwnProperty('uuid')) {
                    extension = new Extension(properties);

                    this._extensions.set(uuid, extension);
                    this.emit('extension-added', extension.uuid, extension);
                }
            } catch (e) {
                logError(e);
            }
        }

        return extension || null;
    }

    /**
     * Check for updates.
     *
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<boolean>} success boolean
     */
    checkForUpdates(cancellable = null) {
        return this._call('CheckForUpdates', null, cancellable);
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
     * Get the extension for @uuid.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<Object>} extension properties
     */
    getExtensionInfo(uuid, cancellable = null) {
        return this._call('GetExtensionInfo', new GLib.Variant('(s)', [uuid]),
            cancellable);
    }

    /**
     * Install an extension from extensions.gnome.org.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<string>} result message
     */
    installRemoteExtension(uuid, cancellable = null) {
        return this._call('InstallRemoteExtension',
            new GLib.Variant('(s)', [uuid]), cancellable);
    }

    /**
     * Uninstall an extension from the local device.
     *
     * @param {string} uuid - an extension UUID
     * @param {Gio.Cancellable} [cancellable] - optional cancellable
     * @return {Promise<string>} result
     */
    uninstallExtension(uuid, cancellable = null) {
        return this._call('UninstallExtension', new GLib.Variant('(s)', [uuid]),
            cancellable);
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
});
