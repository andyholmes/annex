// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported confirmInstall, confirmUninstall, Dialog, Widget */

const {Gio, GLib, GObject, Gtk} = imports.gi;

const Tweener = imports.tweener.tweener;

const Ego = imports.ego;
const Shell = imports.shell;


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
 * Present a dialog to confirm the extension @name should be installed.
 *
 * @param (string} name - an extension name
 * @return {Promise<boolean>} %true if confirmed, %false if cancelled
 */
function confirmInstall(name) {
    return new Promise((resolve, _reject) => {
        const application = Gio.Application.get_default();
        const parent = application ? application.get_active_window() : null;

        const dialog = new Gtk.MessageDialog({
            text: _('Install Extension'),
            secondary_text: _('Install “%s”?').format(name),
            modal: parent instanceof Gtk.Window,
            transient_for: parent,
        });

        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Install'), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        dialog.connect('response', (_dialog, response_id) => {
            resolve(response_id === Gtk.ResponseType.OK);
            _dialog.close();
        });

        dialog.present();
    });
}


/**
 * Present a dialog to confirm the extension @name should be uninstalled.
 *
 * @param (string} name - an extension name
 * @return {Promise<boolean>} %true if confirmed, %false if cancelled
 */
function confirmUninstall(name) {
    return new Promise((resolve, _reject) => {
        const application = Gio.Application.get_default();
        const parent = application ? application.get_active_window() : null;

        const dialog = new Gtk.MessageDialog({
            text: _('Uninstall Extension'),
            secondary_text: _('Uninstall “%s”?').format(name),
            modal: parent instanceof Gtk.Window,
            transient_for: parent,
        });

        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Uninstall'), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        dialog.connect('response', (_dialog, response_id) => {
            resolve(response_id === Gtk.ResponseType.OK);
            _dialog.close();
        });

        dialog.present();
    });
}


/**
 * A stand-alone window for sideloading extensions.
 *
 * This handles files passed to the application and can be opened from the
 * primary menu of Annex.
 */
var Widget = GObject.registerClass({
    GTypeName: 'AnnexExtensionInstallerWidget',
    Template: 'resource:///ca/andyholmes/Annex/ui/extension-installer-widget.ui',
    InternalChildren: [
        'stack',

        // Review
        'extensionIcon',
        'extensionName',
        'extensionCreator',

        'versionRow',
        'versionIcon',
        'versionTitle',
        'versionDescription',

        'shellRow',
        'shellIcon',
        'shellTitle',
        'shellDescription',

        'sourceRow',
        'sourceIcon',
        'sourceTitle',
        'sourceDescription',

        // Progress
        'progressBar',

        // Success
        'viewButton',

        // Error
        'errorTitle',
        'errorDescription',
        'errorView',
    ],
    Properties: {
        'file': GObject.ParamSpec.object(
            'file',
            'File',
            'The extension Zip to install',
            GObject.ParamFlags.READWRITE,
            Gio.File.$gtype
        ),
        'page': GObject.ParamSpec.string(
            'page',
            'Page',
            'The current page name',
            GObject.ParamFlags.READWRITE,
            'open'
        ),
        'title': GObject.ParamSpec.string(
            'title',
            'Title',
            'Installer Title',
            GObject.ParamFlags.READABLE,
            null
        ),
        'uuid': GObject.ParamSpec.string(
            'uuid',
            'UUID',
            'Extension UUID',
            GObject.ParamFlags.READABLE,
            null
        ),
    },
}, class AnnexExtensionInstaller extends Gtk.Box {
    _init(params = {}) {
        super._init(params);

        this._cancellable = new Gio.Cancellable();
        this._extension = null;
        this._info = null;
        this._proposed = null;

        this.bind_property('page', this._stack, 'visible-child-name',
            GObject.BindingFlags.SYNC_CREATE |
            GObject.BindingFlags.BIDIRECTIONAL);

        // Actions
        this._actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('installer', this._actionGroup);

        this._actions = {
            cancel: this._onCancelActivated,
            close: this._onCancelActivated,
            install: this._onInstallActivated,
            open: this._onOpenActivated,
            previous: this._onPreviousActivated,
        };

        for (const [name, activate] of Object.entries(this._actions)) {
            this._actions[name] = new Gio.SimpleAction({
                name: name,
            });
            this._actions[name].connect('activate', activate.bind(this));

            this._actionGroup.add_action(this._actions[name]);
        }

        this._onPageChanged();
        this._refresh();
    }

    get file() {
        if (this._file === undefined)
            this._file = null;

        return this._file;
    }

    set file(file) {
        if (this.file === file)
            return;

        this.reset();

        this._file = file;
        this.notify('file');

        this._refresh();
    }

    get release() {
        if (this._release === undefined)
            this._release = null;

        return this._release;
    }

    set release(release) {
        if (this.release === release)
            return;

        this.reset();

        this._release = release;
        this._refresh();
    }

    get title() {
        if (this._title === null)
            return this._title = null;

        return this._title;
    }

    get uuid() {
        if (this._proposed)
            return this._proposed.uuid;

        return null;
    }

    _onPageChanged(_stack, _pspec) {
        const child = this._stack.get_visible_child();
        const page = this._stack.get_page(child);

        switch (page.name) {
            case 'open':
                this._actions.cancel.enabled = true;
                this._actions.install.enabled = false;
                this._actions.previous.enabled = false;
                break;

            case 'review':
                this._actions.cancel.enabled = true;
                this._actions.install.enabled = this._proposed !== null;
                this._actions.previous.enabled = false;
                break;

            case 'progress':
                this._actions.cancel.enabled = true;
                this._actions.install.enabled = false;
                this._actions.previous.enabled = false;
                break;

            case 'success':
                this._actions.cancel.enabled = false;
                this._actions.install.enabled = false;
                this._actions.previous.enabled = false;
                break;

            case 'error':
                this._actions.cancel.enabled = false;
                this._actions.install.enabled = false;
                this._actions.previous.enabled = true;
                break;
        }

        this._title = page.title;
        this.notify('title');
    }

    /*
     * Actions
     */
    _onCancelActivated(_action, _parameter) {
        this._cancellable.cancel();

        const parent = this.get_root();

        if (parent instanceof Gtk.Window)
            parent.close();
    }

    // TODO: animation settings
    _setProgress(progress = 0.0, total = 1.0) {
        Tweener.removeTweens(this._progressBar);
        this._progressBar.fraction = progress;

        if (progress < total) {
            const duration = 5;
            const start = GLib.get_monotonic_time();

            Tweener.addTween(this._progressBar, {
                // property name: target value
                fraction: total,
                // seconds
                time: duration * (total - progress),
                transition: 'easeOutCubic',
                onUpdate: () => {
                    if (this.page === 'progress')
                        return;

                    const elapsed = (GLib.get_monotonic_time() - start) / 1000;

                    if (elapsed > 100)
                        this.page = 'progress';
                }
            });
        }
    }

    async _onInstallActivated(_action, _parameter) {
        try {
            this._actions.install.enabled = false;
            this._setProgress(0.0, 0.9);

            // If this is an EGO release, pull the file now
            if (this.release && this.file === null) {
                const repository = Ego.Repository.getDefault();
                this._file = await repository.lookupExtension(this.release.uuid,
                    this.release.version_tag);
                this.notify('file');
            }

            this._setProgress(0.9, 1.0);

            // Once we're sure we have a file, install it
            const manager = Shell.ExtensionManager.getDefault();
            await manager.installExtensionFile(this.file, this._cancellable);

            this._setProgress(1.0, 1.0);

            // When that succeeds switch to the success page
            this._viewButton.action_target = GLib.Variant.new_string(this.uuid);
            this._stack.visible_child_name = 'success';
        } catch (e) {
            this._setProgress(1.0);
            this.showError(e);
        }
    }

    async _onOpenActivated(_action, _parameter) {
        try {
            await this.openFile();
            this._stack.visible_child_name = 'review';
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                this.showError(e);
                this.file = null;
            }
        }
    }

    _onPreviousActivated(_action, _parameter) {
        // Back out to the extension page, before falling back to the start page
        if (this.file === null && this.uuid === null)
            this._stack.set_visible_child_name('open');
        else
            this._stack.set_visible_child_name('review');
    }

    /*
     * Internal
     */
    async _checkExtension() {
        if (this.uuid && this._extension === null) {
            try {
                const manager = Shell.ExtensionManager.getDefault();
                const result = await manager.lookup(this.uuid);

                if (result && result.uuid === this.uuid) {
                    this._extension = result;
                    this._extensionChangedId = this._extension.connect('notify',
                        this._redraw.bind(this));
                }
            } catch (e) {
                debug(e);
            }
        }

        return this._extension instanceof Shell.Extension;
    }

    async _checkInfo() {
        if (this.uuid && this._info === null) {
            try {
                const repository = Ego.Repository.getDefault();
                const result = await repository.lookup(this.uuid);

                if (result && result.uuid === this.uuid) {
                    this._info = result;
                    this._infoChangedId = this._info.connect('notify',
                        this._redraw.bind(this));
                }
            } catch (e) {
                debug(e);
            }
        }

        return this._info instanceof Ego.ExtensionInfo;
    }

    async _checkFile() {
        if (this.file && this._proposed === null) {
            try {
                const metadata = await Shell.loadExtension(this.file);

                if (this._proposed === null) {
                    this._proposed = new Shell.Extension(metadata);
                    this._proposedChangedId = this._proposed.connect('notify',
                        this._redraw.bind(this));
                }

                this._stack.visible_child_name = 'review';
                this.notify('uuid');
            } catch (e) {
                this.showError(e);

                this._file = null;
                this.notify('file');
            }
        }

        return this._proposed instanceof Shell.Extension;
    }

    _checkRelease() {
        if (this.release && this._proposed === null) {
            try {
                this._proposed = this.release;

                this._stack.visible_child_name = 'review';
                this.notify('uuid');
            } catch (e) {
                this.showError(e);
                this._release = null;
            }
        }

        return this.release !== null;
    }

    /*
     * UI
     */
    _redrawShell() {
        let title = null;
        let description = null;
        let css_classes = ['installer-row-icon'];

        if (this._proposed) {
            const manager = Shell.ExtensionManager.getDefault();
            const shellVersion = manager.shell_version;

            if (Shell.releaseCompatible(this._proposed, shellVersion)) {
                // TRANSLATORS: eg. "Compatible with GNOME 40.1"
                title = _('Compatible with GNOME %s').format(shellVersion);
                description = _('Developed to support your desktop');
                css_classes = ['installer-row-icon', 'success'];
            } else {
                // TRANSLATORS: eg. "Incompatible with GNOME 40.1"
                title = _('Incompatible with GNOME %s').format(shellVersion);
                description = _('The extension may have problems or not work');
                css_classes = ['installer-row-icon', 'warning'];
            }
        }

        this._shellTitle.label = title;
        this._shellDescription.label = description;
        this._shellIcon.css_classes = css_classes;
    }

    _redrawSource() {
        let icon_name = null;
        let title = null;
        let description = null;
        let css_classes = ['installer-row-icon'];

        if (this.release) {
            icon_name = 'security-high-symbolic';
            title = _('Verified Source');
            description = _('Audited for malicious code');
            css_classes = ['installer-row-icon', 'success'];
        } else if (this.file) {
            icon_name = 'security-medium-symbolic';
            title = _('Unverified Source');
            description = _('There may be security or privacy issues');
            css_classes = ['installer-row-icon', 'warning'];
        }

        this._sourceIcon.css_classes = css_classes;
        this._sourceIcon.icon_name = icon_name;
        this._sourceTitle.label = title;
        this._sourceDescription.label = description;
    }

    _redrawVersion() {
        let icon_name = null;
        let css_classes = ['installer-row-icon'];
        let title = null;
        let description = null;
        let installable = false;

        if (this._extension) {
            const currentVersion = this._extension.version;
            const proposedVersion = this._proposed.version;

            title = _('Version %d').format(this._proposed.version);

            if (proposedVersion > currentVersion) {
                icon_name = 'pan-up-symbolic';
                description = _('Upgrade from v%s').format(currentVersion);
                css_classes = ['installer-row-icon', 'success'];
                installable = true;
            } else if (proposedVersion < currentVersion) {
                icon_name = 'pan-down-symbolic';
                description = _('Downgrade from v%s').format(currentVersion);
                css_classes = ['installer-row-icon', 'warning'];
                installable = true;
            } else {
                icon_name = 'object-select-symbolic';
                description = _('Already installed');
                css_classes = ['installer-row-icon'];
                installable = false;
            }
        } else if (this._proposed) {
            icon_name = 'list-add-symbolic';
            title = _('Version %d').format(this._proposed.version);
            description = _('New extension');
            css_classes = ['installer-row-icon'];
            installable = true;
        }

        this._versionIcon.icon_name = icon_name;
        this._versionIcon.css_classes = css_classes;
        this._versionTitle.label = title;
        this._versionDescription.label = description;

        this._actions.install.enabled = installable && this.page === 'review';
    }

    _redraw() {
        // Check if we have release or file metadata
        if (this._proposed)
            this._extensionName.label = this._proposed.name;
        else
            this._extensionName.label = null;

        // Check if we have metadata from EGO
        if (this._info) {
            this._extensionCreator.label = this._info.creator_markup;
            this._extensionIcon.gicon = this._info.icon;
        } else {
            this._extensionCreator.label = _('Unknown Developer');
            this._extensionIcon.icon_name = 'ego-plugin';
        }

        // Redraw the review page
        this._onPageChanged();
        this._redrawShell();
        this._redrawSource();
        this._redrawVersion();
    }

    async _refresh() {
        try {
            const hasFile = await this._checkFile();

            if (hasFile || this._checkRelease()) {
                await this._checkExtension();
                await this._checkInfo();
            }

            this._redraw();
        } catch (e) {
            debug(e);
        }
    }

    /**
     * Open a dialog for selecting a file.
     */
    async openFile() {
        this.file = await new Promise((resolve, reject) => {
            const application = Gio.Application.get_default();
            const parent = application ? application.get_active_window() : null;

            const filter = new Gtk.FileFilter({
                name: _('Zip File'),
            });
            filter.add_mime_type('application/zip');
            filter.add_pattern('*.zip');

            const dialog = new Gtk.FileChooserNative({
                action: Gtk.FileChooserAction.OPEN,
                filter: filter,
                title: _('Install Zip…'),
                modal: parent instanceof Gtk.Window,
                transient_for: parent,
            });

            dialog.connect('response', (_dialog, response_id) => {
                if (response_id === Gtk.ResponseType.ACCEPT) {
                    resolve(_dialog.get_file());
                } else {
                    const error = new Gio.IOErrorEnum({
                        code: Gio.IOErrorEnum.CANCELLED,
                        message: _('Operation cancelled'),
                    });

                    reject(error);
                }
            });

            dialog.show();
        });
    }

    /**
     * Reset the installer back to a pristine state.
     */
    reset() {
        if (this._proposed) {
            if (this._proposed instanceof GObject.Object)
                this._proposed.disconnect(this._proposedChangedId);

            this._proposed = null;
        }

        if (this._extension) {
            this._extension.disconnect(this._extensionChangedId);
            this._extension = null;
        }

        if (this._info) {
            this._info.disconnect(this._infoChangedId);
            this._info = null;
        }

        this._cancellable = new Gio.Cancellable();
        this._file = null;
        this._release = null;

        this._setProgress(1.0);
        this._stack.visible_child_name = 'open';
        this._viewButton.action_target = GLib.Variant.new_string('');
    }

    /**
     * Switch to page for displaying errors in user-friendly way and present
     * @error. This function is public so that parent classes can use it.
     *
     * @param {Error|GLib.Error} error - the error to display
     */
    showError(error) {
        this._errorView.buffer.text = `${error}\n\nStack trace:\n`;
        this._errorView.buffer.text += error.stack.split('\n').map(
            line => `  ${line}`).join('\n');

        this._stack.visible_child_name = 'error';
    }
});


/**
 * A stand-alone window for sideloading extensions.
 *
 * This handles files passed to the application and can be opened from the
 * primary menu of Annex.
 */
var Dialog = GObject.registerClass({
    GTypeName: 'AnnexExtensionInstallerDialog',
    Template: 'resource:///ca/andyholmes/Annex/ui/extension-installer-dialog.ui',
    InternalChildren: [
        'cancelButton',
        'installButton',
        'previousButton',
        'installerWidget',
    ],
    Properties: {
        'file': GObject.ParamSpec.object(
            'file',
            'File',
            'The extension Zip to install',
            GObject.ParamFlags.READWRITE,
            Gio.File.$gtype
        ),
        'uuid': GObject.ParamSpec.string(
            'uuid',
            'UUID',
            'Extension UUID',
            GObject.ParamFlags.READABLE,
            null
        ),
    },
}, class AnnexExtensionInstallerDialog extends Gtk.ApplicationWindow {
    _init(params = {}) {
        super._init(params);

        // Bind the dialog to the widget, to pass the value at construction
        this.bind_property('file', this._installerWidget, 'file',
            GObject.BindingFlags.SYNC_CREATE |
            GObject.BindingFlags.BIDIRECTIONAL);

        // Bind the widget to the dialog, to sync the value at construction
        this._installerWidget.bind_property('title', this, 'title',
            GObject.BindingFlags.SYNC_CREATE);

        // Inject the widget GActionGroup
        this.insert_action_group('installer',
            this._installerWidget._actionGroup);
    }

    get uuid() {
        return this._installerWidget.uuid;
    }

    _onPreviousActivated(_action, _parameter) {
        // Back out to the extension page, before falling back to the start page
        if (this.file === null && this.uuid === null)
            this._installerWidget.page = 'open';
        else
            this._installerWidget.page = 'review';
    }

    /**
     * Open a dialog for selecting a file.
     */
    openFile() {
        return this._installerWidget.openFile();
    }
});

