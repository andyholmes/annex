// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExtensionView */

const {GLib, Gio, GObject, Gtk} = imports.gi;

const Tweener = imports.tweener.tweener;

const Ego = imports.ego;
const Shell = imports.shell;
const ExtensionInstaller = imports.extensionInstaller;


/**
 * A simple dialog, tailored for displaying screenshots.
 */
const Screenshot = GObject.registerClass({
    GTypeName: 'AnnexExtensionViewScreenshot',
    Template: 'resource:///ca/andyholmes/Annex/ui/extension-view-screenshot.ui',
    InternalChildren: [
        'screenshotPicture',
    ],
    Properties: {
        'file': GObject.ParamSpec.object(
            'file',
            'File',
            'The screenshot file',
            GObject.ParamFlags.READWRITE,
            Gio.File.$gtype
        ),
    },
}, class AnnexExtensionViewScreenshot extends Gtk.Window {
    _init(params = {}) {
        super._init(params);

        this.bind_property('file', this._screenshotPicture, 'file',
            GObject.BindingFlags.SYNC_CREATE);
    }

    _onClose() {
        this.close();
    }
});


/**
 * A widget for extension version rows.
 */
const VersionRow = GObject.registerClass({
    GTypeName: 'AnnexExtensionVersionRow',
    Template: 'resource:///ca/andyholmes/Annex/ui/extension-version-row.ui',
    InternalChildren: [
        'shellVersionLabel',
        'statusIcon',
        'versionLabel',
    ],
}, class AnnexExtensionVersionRow extends Gtk.ListBoxRow {
    get release() {
        if (this._release === undefined)
            this._release = null;

        return this._release;
    }

    set release(release) {
        this._release = release;

        if (this.release !== null) {
            const {shell_version, version} = release;

            this._shellVersionLabel.label = shell_version.sort().join(', ');
            this._versionLabel.label = `v${version}`;
        } else {
            this._shellVersionLabel.label = null;
            this._versionLabel.label = null;
        }
    }

    get status() {
        if (this._status === undefined)
            this._status = Ego.UpdateType.NONE;

        return this._status;
    }

    set status(status) {
        switch (status) {
            case Ego.UpdateType.NONE:
                this._statusIcon.icon_name = 'object-select-symbolic';
                this._statusIcon.tooltip_text = _('Already installed');
                break;

            case Ego.UpdateType.BLACKLIST:
                this._statusIcon.icon_name = 'dialog-warning-symbolic';
                this._statusIcon.tooltip_text = _('Incompatible');
                break;

            case Ego.UpdateType.DOWNGRADE:
                this._statusIcon.icon_name = 'pan-down-symbolic';
                this._statusIcon.tooltip_text = _('Downgrade');
                break;

            case Ego.UpdateType.NEW:
                this._statusIcon.icon_name = 'list-add-symbolic';
                this._statusIcon.tooltip_text = _('Install');
                break;

            case Ego.UpdateType.UPGRADE:
                this._statusIcon.icon_name = 'pan-up-symbolic';
                this._statusIcon.tooltip_text = _('Upgrade');
                break;

            default:
                this._statusIcon.icon_name = null;
                this._statusIcon.tooltip_text = null;
        }

        this._status = status;
    }

    get version() {
        if (this.release === null)
            return 0;

        return this.release.version;
    }
});


/**
 * A dialog for an extension's available versions.
 */
const VersionDialog = GObject.registerClass({
    GTypeName: 'AnnexExtensionVersionDialog',
    Template: 'resource:///ca/andyholmes/Annex/ui/extension-version-dialog.ui',
    InternalChildren: [
        'windowTitle',
        'windowSubtitle',

        'versionList',
        'installerWidget',
        'stack',
    ],
    Properties: {
        'info': GObject.ParamSpec.object(
            'info',
            'Result',
            'The search info object',
            GObject.ParamFlags.READWRITE,
            Ego.ExtensionInfo.$gtype
        ),
    },
}, class AnnexExtensionVersionDialog extends Gtk.ApplicationWindow {
    _init(params = {}) {
        super._init(params);

        this._extension = null;

        this.insert_action_group('installer',
            this._installerWidget._actionGroup);

        // Actions
        this._actions = {
            previous: this._onPreviousActivated,
        };

        for (const [name, activate] of Object.entries(this._actions)) {
            this._actions[name] = new Gio.SimpleAction({
                name: name,
            });
            this._actions[name].connect('activate', activate.bind(this));
            this.add_action(this._actions[name]);
        }

        this._versionList.set_sort_func(this._sort);
    }

    get info() {
        if (this._info === undefined)
            this._info = null;

        return this._info;
    }

    set info(info) {
        if (this.info === info)
            return;

        this._info = info;
        this.notify('info');

        this._refresh();
    }

    _onPreviousActivated(_action, _parameter) {
        const currentPage = this._stack.get_visible_child_name();

        if (currentPage === 'versions') {
            this.close();
        } else {
            this._installerWidget.reset();
            this._stack.visible_child_name = 'versions';
        }
    }

    _onPageChanged(_stack, _pspec) {
        const title = this.info ? this.info.name : null;
        let subtitle = _('Versions');

        switch (this._stack.get_visible_child_name()) {
            case 'versions':
                subtitle = _('Versions');
                break;

            case 'install':
                subtitle = _('Version %s').format(this._release.version);
                break;
        }

        this._windowTitle.label = title;
        this._windowSubtitle.label = subtitle;
    }

    _onRowActivated(_box, row) {
        this._release = row.release;
        this._installerWidget.release = row.release;

        this._installerWidget.page = 'review';
        this._stack.visible_child_name = 'install';
    }

    _redraw() {
        /* Remove current rows */
        let row = null;

        while ((row = this._versionList.get_first_child()))
            this._versionList.remove(row);

        this._onPageChanged();

        if (this.info === null)
            return;

        /* Add a row for each release */
        const manager = Shell.ExtensionManager.getDefault();
        const shellVersion = manager.shell_version;

        for (const release of this.info.releases) {
            const row = new VersionRow();
            row.release = release;

            if (this._extension) {
                if (release.version === this._extension.version)
                    row.status = Ego.UpdateType.NONE;
                else if (release.version > this._extension.version)
                    row.status = Ego.UpdateType.UPGRADE;
                else if (release.version < this._extension.version)
                    row.status = Ego.UpdateType.DOWNGRADE;
            } else if (Shell.releaseCompatible(release, shellVersion)) {
                row.status = Ego.UpdateType.NEW;
            } else {
                row.status = Ego.UpdateType.BLACKLIST;
            }

            this._versionList.append(row);
        }
    }

    async _refresh() {
        if (this.info !== null && this._extension === null) {
            const manager = Shell.ExtensionManager.getDefault();
            this._extension = await manager.lookupPending(this.info.uuid);

            if (this._extension === null)
                this._extension = await manager.lookup(this.info.uuid);
        }

        this._redraw();
    }

    _sort(row1, row2) {
        // Sort installed version first
        if (row1.status === Ego.UpdateType.NONE)
            return -1;

        // NOTE: comparing row2 => row1 for descending sort
        return parseInt(row2.version) - parseInt(row1.version);
    }
});


/**
 * A widget for viewing the details of an extension.
 *
 * This is the main widget for displaying extensions in the store and operates
 * solely based on the `uuid` property. Extension metadata is loaded
 * transparently and actions are performed asynchronously in the background.
 */
var ExtensionView = GObject.registerClass({
    GTypeName: 'AnnexExtensionView',
    Template: 'resource:///ca/andyholmes/Annex/ui/extension-view.ui',
    InternalChildren: [
        'extensionIcon',
        'extensionName',
        'extensionCreator',
        'contentScroll',

        'installButton',
        'uninstallButton',
        'pendingButton',
        'prefsButton',
        'progressButton',
        'progressBar',

        'screenshotBox',
        'screenshotPicture',
        'extensionDescription',
    ],
    Properties: {
        'uuid': GObject.ParamSpec.string(
            'uuid',
            'UUID',
            'Extension UUID',
            GObject.ParamFlags.READWRITE,
            null
        ),
    },
}, class AnnexExtensionView extends Gtk.Box {
    _init(params = {}) {
        super._init(params);

        this._extension = null;
        this._info = null;

        // Actions
        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('view', actionGroup);

        this._actions = {
            install: this._onInstallActivated,
            prefs: this._onPrefsActivated,
            uninstall: this._onUninstallActivated,
            update: this._onUpdateActivated,
            versions: this._onVersionsActivated,
            website: this._onWebsiteActivated,
        };

        for (const [name, activate] of Object.entries(this._actions)) {
            this._actions[name] = new Gio.SimpleAction({
                name: name,
                enabled: false,
            });
            this._actions[name].connect('activate', activate.bind(this));
            actionGroup.add_action(this._actions[name]);
        }

        // Watch the extension manager for changes to the extension in view
        this._manager = Shell.ExtensionManager.getDefault();
        this._manager.connect('extension-added',
            this._onExtensionAdded.bind(this));
        this._manager.connect('extension-removed',
            this._onExtensionRemoved.bind(this));
    }

    get uuid() {
        if (this._uuid === undefined)
            this._uuid = null;

        return this._uuid;
    }

    set uuid(uuid) {
        if (this.uuid === uuid)
            return;

        if (this._extension) {
            this._extension.disconnect(this._extensionChangedId);
            this._extension = null;
        }

        if (this._info) {
            this._info.disconnect(this._infoChangedId);
            this._info = null;
        }

        this._uuid = uuid;
        this.notify('uuid');

        this._refresh();
    }

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

    async _checkUpdate() {
        if (this._extension && this._info) {
            try {
                const manager = Shell.ExtensionManager.getDefault();

                // Check for pending update
                const pending = await manager.lookupPending(this.uuid);
                this._extension.has_update = pending !== null;

                // Check for available update
                const latest = this._info.getLatestVersion(manager.shell_version);
                const available = this._extension.version < latest.version;

                this._extension.can_update = available &&
                    !this._extension.has_update;
            } catch (e) {
                debug(e);
            } finally {
                this._redraw();
            }
        }
    }

    async _refresh() {
        if (this.uuid !== null) {
            // Only wait for the info if the extension is unavailable
            if (await this._checkExtension())
                this._checkInfo().then(this._redraw.bind(this));
            else
                await this._checkInfo();

            this._redraw();
        }
    }

    /*
     * UI
     */
    _onScreenshotClicked(_gesture, _n_press, _x, _y) {
        const parent = this.get_root();
        const dialog = new Screenshot({
            file: this._screenshotPicture.file,
            modal: parent instanceof Gtk.Window,
            transient_for: parent,
        });

        dialog.present();
    }

    _onUnmap() {
        // Drop references when the widget is no longer in use
        if (this._extension) {
            this._extension.disconnect(this._extensionChangedId);
            this._extension = null;
        }

        if (this._info) {
            this._info.disconnect(this._infoChangedId);
            this._info = null;
        }
    }

    _redraw() {
        // Common
        if (this._info) {
            this._extensionName.label = this._info.name;
            this._extensionCreator.label = this._info.creator_markup;
            this._extensionDescription.label = this._info.description;
        } else if (this._extension) {
            this._extensionName.label = this._extension.name;
            this._extensionCreator.label = _('Unknown Developer');
            this._extensionDescription.label = this._extension.description;
        } else {
            this._extensionName.label = null;
            this._extensionCreator.label = null;
            this._extensionDescription.label = null;
            this._contentScroll.vadjustment.value = 0.0;
        }

        // Icon
        if (this._info && this._info.icon)
            this._extensionIcon.gicon = this._info.icon;
        else
            this._extensionIcon.gicon = new Gio.ThemedIcon({name: 'ego-plugin'});

        // Screenshot
        if (this._info && this._info.screenshot) {
            this._screenshotPicture.file = this._info.screenshot;
            this._screenshotBox.visible = true;
        } else {
            this._screenshotBox.visible = false;
            this._screenshotPicture.file = null;
        }

        // Actions
        this._actions.install.enabled = this._extension === null && this._info;
        this._actions.uninstall.enabled = this._extension !== null &&
            this._extension.type === Shell.ExtensionType.USER;
        this._pendingButton.visible = this._extension && this._extension.has_update;
        this._actions.prefs.enabled = this._extension && this._extension.has_prefs;
        this._actions.update.enabled = this._extension && this._extension.can_update;
        this._actions.versions.enabled = this._info !== null;
        this._actions.website.enabled = this._extension && this._extension.url;
    }

    // TODO: animation settings
    _startPulse() {
        if (this._progressId)
            return;

        this._progressButton.visible = true;
        this._progressId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._progressBar.pulse();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPulse() {
        if (this._progressId)
            GLib.Source.remove(this._progressId);

        this._progressId = 0;
        this._progressButton.visible = false;
    }

    /*
     * Shell.ExtensionManager Callbacks
     */
    _onExtensionAdded(_manager, uuid, extension) {
        if (this.uuid === uuid && this._extension === null) {
            this._extension = extension;
            this._extensionChangedId = this._extension.connect('notify',
                this._redraw.bind(this));

            this._redraw();
        }
    }

    _onExtensionRemoved(_manager, uuid, _extension) {
        if (this.uuid === uuid && this._extension) {
            this._extension.disconnect(this._extensionChangedId);
            this._extension = null;

            this._redraw();
        }
    }

    /*
     * Actions
     */
    _confirmUninstall() {
        return new Promise((resolve, _reject) => {
            const dialog = new Gtk.MessageDialog({
                text: _('Uninstall Extension'),
                secondary_text: _('Uninstall “%s”?').format(this._extension.name),
                modal: true,
                transient_for: this.get_root(),
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

    async _onInstallActivated() {
        try {
            this._actions.install.enabled = false;
            this._startPulse();

            const result = await this._manager.installExtension(this.uuid,
                this._cancellable);

            if (result !== 'successful')
                throw Error(result);
        } catch (e) {
            warning(e, this.uuid);
        } finally {
            this._stopPulse();
            this._redraw();
        }
    }

    async _onUninstallActivated() {
        try {
            if (await this._confirmUninstall())
                await this._manager.uninstallExtension(this.uuid);
        } catch (e) {
            warning(e, this.uuid);
        }
    }

    async _onPrefsActivated() {
        try {
            await this._manager.launchExtensionPrefs(this.uuid);
        } catch (e) {
            warning(e, this.uuid);
        }
    }

    async _onUpdateActivated(_action, _parameter) {
        try {
            const latest = this._info.getLatestVersion(this._manager.shell_version);

            if (latest !== undefined) {
                const repository = Ego.Repository.getDefault();
                const zip = await repository.lookupExtension(this.uuid,
                    latest.pk);
                await this._manager._queueUpdate(this.uuid, zip);
            }
        } catch (e) {
            warning(e, this.uuid);
        } finally {
            this._refresh();
        }
    }

    _onVersionsActivated() {
        const dialog = new VersionDialog({
            application: Gio.Application.get_default(),
            modal: true,
            transient_for: this.get_root(),
        });
        dialog._extension = this._extension;
        dialog.info = this._info;
        dialog.present();
    }

    _onWebsiteActivated() {
        Gio.AppInfo.launch_default_for_uri(this._extension.url,
            this.get_display().get_app_launch_context());
    }
});

