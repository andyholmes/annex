// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExtensionView */

const {Gio, GLib, GObject, Gtk} = imports.gi;

const Ego = imports.ego;
const Shell = imports.shell;


function _createLink(text, url) {
    return `<a href="${url}">${text}</a>`;
}

/**
 * An extension widget for listboxes.
 */
const VersionRow = GObject.registerClass({
    GTypeName: 'AnnexDetailedVersionRow',
    Template: 'resource:///ca/andyholmes/Annex/ui/detailed-version-row.ui',
    InternalChildren: [
        'downloadButton',
        'versionLabel',
        'shellVersionLabel',
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
}, class AnnexDetailedVersionRow extends Gtk.ListBoxRow {
    _init(params = {}) {
        super._init(params);

        const actionGroup = new Gio.SimpleActionGroup();

        const downloadAction = new Gio.SimpleAction({
            name: 'download',
            parameter_type: null,
        });
        downloadAction.connect('activate',
            this._onDownloadActivated.bind(this));
        actionGroup.add_action(downloadAction);

        this.insert_action_group('version', actionGroup);
    }

    get version() {
        if (this._version === undefined)
            this._version = 1;

        return this._version;
    }

    set version(version) {
        if (this.version === version)
            return;

        this._version = version;
        this._versionLabel.label = `v${version}`;
    }

    get shell_versions() {
        if (this._shell_versions === undefined)
            this._shell_versions = [];

        return this._shell_versions;
    }

    set shell_versions(versions) {
        if (this.shell_versions === versions)
            return;

        this._shell_versions = versions;
        this._shellVersionLabel.label = this.shell_versions.sort().join(', ');
    }

    get version_tag() {
        if (this._version_tag === undefined)
            this._version_tag = 0;

        return this._version_tag;
    }

    set version_tag(tag) {
        if (this.version_tag === tag)
            return;

        this._version_tag = tag;
    }

    async _onDownloadActivated() {
        try {
            /* Query the user */
            const dialog = new Gtk.FileChooserNative({
                accept_label: _('Save'),
                action: Gtk.FileChooserAction.SAVE,
                cancel_label: _('Cancel'),
                modal: true,
                title: _('Download v%d').format(this.version),
                transient_for: this.get_root(),
            });

            const dest = await new Promise((resolve, reject) => {
                dialog.connect('response', (_dialog, response_id) => {
                    if (response_id === Gtk.ResponseType.ACCEPT) {
                        resolve(dialog.get_file());
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

            /* Query EGO and cache the result */
            const repository = Ego.Repository.getDefault();

            const file = await repository.lookupExtensionTag(this.uuid,
                this.version_tag);

            /* Copy to the destination */
            await new Promise((resolve, reject) => {
                file.copy_async(
                    dest,
                    Gio.FileCopyFlags.OVERWRITE,
                    GLib.PRIORITY_DEFAULT, null, null, (_file, res) => {
                        try {
                            resolve(_file.copy_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            return dest;
        } catch (e) {
            warning(e);

            return null;
        }
    }

    setInfo(info, version, versionInfo) {
        this.uuid = info.uuid;
        this.shell_versions = versionInfo.shell_versions;
        this.version = version;
        this.version_tag = versionInfo.pk;
    }
});


/**
 * A dialog for an extension's available versions.
 */
var VersionDialog = GObject.registerClass({
    GTypeName: 'AnnexDetailedVersionDialog',
    Template: 'resource:///ca/andyholmes/Annex/ui/detailed-version-dialog.ui',
    InternalChildren: [
        'previousButton',
        'versionList',
    ],
}, class AnnexDetailedVersionDialog extends Gtk.ApplicationWindow {
    _init(params = {}) {
        super._init(params);

        this._versionList.set_sort_func(this._sort);
    }

    _sort(row1, row2) {
        // NOTE: comparing row2 => row1 for descending sort
        return row2.version.localeCompare(row1.version);
    }

    setInfo(info) {
        let row;

        while ((row = this._versionList.get_first_child()))
            this._versionList.remove(row);

        const versions = Ego.parseVersionMap(info);

        for (const [version, versionInfo] of Object.entries(versions)) {
            row = new VersionRow();
            row.setInfo(info, version, versionInfo);

            this._versionList.append(row);
        }
    }
});


/**
 * A widget for viewing the details of an extension.
 */
var ExtensionView = GObject.registerClass({
    GTypeName: 'AnnexExtensionView',
    Template: 'resource:///ca/andyholmes/Annex/ui/extension-view.ui',
    InternalChildren: [
        'iconImage',
        'nameLabel',
        'creatorLabel',
        'descriptionLabel',
        'screenshotBox',
        'screenshotPicture',

        'installButton',
        'uninstallButton',
        'prefsButton',
    ],
    Properties: {
        'extension': GObject.ParamSpec.object(
            'extension',
            'Extension',
            'Extension Object',
            GObject.ParamFlags.READWRITE,
            Shell.Extension.$gtype
        ),
        'info': GObject.ParamSpec.object(
            'info',
            'Info',
            'Extension Info',
            GObject.ParamFlags.READWRITE,
            Ego.ExtensionInfo.$gtype
        ),
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

        // Manager
        this._manager = Shell.ExtensionManager.getDefault();

        this._manager.connect('extension-added',
            this._onExtensionAdded.bind(this));

        this._manager.connect('extension-removed',
            this._onExtensionRemoved.bind(this));

        // Actions
        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('view', actionGroup);

        this._installAction = new Gio.SimpleAction({
            name: 'install',
            enabled: true,
        });
        this._installAction.connect('activate',
            this._onInstallActivated.bind(this));
        actionGroup.add_action(this._installAction);

        this._uninstallAction = new Gio.SimpleAction({
            name: 'uninstall',
            enabled: false,
        });
        this._uninstallAction.connect('activate',
            this._onUninstallActivated.bind(this));
        actionGroup.add_action(this._uninstallAction);

        this._prefsAction = new Gio.SimpleAction({
            name: 'prefs',
            enabled: false,
        });
        this._prefsAction.connect('activate',
            this._onPrefsActivated.bind(this));
        actionGroup.add_action(this._prefsAction);

        this._versionsAction = new Gio.SimpleAction({
            name: 'versions',
            enabled: true,
        });
        this._versionsAction.connect('activate',
            this._onVersionsActivated.bind(this));
        actionGroup.add_action(this._versionsAction);

        this._websiteAction = new Gio.SimpleAction({
            name: 'website',
            enabled: true,
        });
        this._websiteAction.connect('activate',
            this._onWebsiteActivated.bind(this));
        actionGroup.add_action(this._websiteAction);
    }

    get extension() {
        if (this._extension === undefined)
            this._extension = null;

        return this._extension;
    }

    set extension(extension) {
        if (this.extension === extension)
            return;

        this._extension = extension;
        this.notify('extension');

        this._redraw();
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

        this._redraw();
    }

    get uuid() {
        if (this._uuid === undefined)
            this._uuid = null;

        return this._uuid;
    }

    set uuid(uuid) {
        if (this.uuid === uuid)
            return;

        this._uuid = uuid;
        this.notify('uuid');

        this._update();
    }

    _redraw() {
        // Common
        if (this.info) {
            this._nameLabel.label = this.info.name;
            this._creatorLabel.label = _createLink(this.info.creator,
                this.info.creator_url);
            this._descriptionLabel.label = this.info.description;
        } else if (this.extension) {
            this._nameLabel.label = this.extension.name;
            this._creatorLabel.label = null;
            this._descriptionLabel.label = this.extension.description;
        } else {
            this._nameLabel.label = null;
            this._creatorLabel.label = null;
            this._descriptionLabel.label = null;
        }

        // Icon
        if (this.info && this.info.icon)
            this._iconImage.gicon = this.info.icon;
        else
            this._iconImage.gicon = new Gio.ThemedIcon({name: 'ego-plugin'});

        // Screenshot
        if (this.info && this.info.screenshot) {
            this._screenshotPicture.file = this.info.screenshot;
            this._screenshotBox.visible = true;
        } else {
            this._screenshotPicture.file = null;
            this._screenshotBox.visible = false;
        }

        // Actions
        this._installAction.enabled = this.extension === null && this.info;
        this._uninstallAction.enabled = this.extension !== null &&
            this.extension.type === Shell.ExtensionType.USER;
        this._prefsAction.enabled = this.extension && this.extension.has_prefs;
        this._versionsAction.enabled = this.info !== null;
    }

    async _update() {
        if (this.uuid === null) {
            this._extension = null;
            this._info = null;
        }

        if (this.uuid && this.extension === null) {
            try {
                const manager = Shell.ExtensionManager.getDefault();
                const result = await manager.lookupExtension(this.uuid);

                if (result && result.uuid === this.uuid)
                    this.extension = result;
            } catch (e) {
                debug(e);
            }
        }

        if (this.uuid && this.info === null) {
            try {
                const repository = Ego.Repository.getDefault();
                const result = await repository.lookupExtension(this.uuid);

                if (result && result.uuid === this.uuid)
                    this.info = result;
            } catch (e) {
                debug(e);
            }
        }

        this._redraw();
    }

    _onExtensionAdded(_manager, uuid, extension) {
        if (this.uuid === uuid)
            this.extension = extension;
    }

    _onExtensionRemoved(_manager, uuid, _extension) {
        if (this.uuid === uuid)
            this.extension = null;
    }

    _confirmUninstall() {
        return new Promise((resolve, _reject) => {
            const dialog = new Gtk.MessageDialog({
                text: _('Uninstall Extension'),
                secondary_text: _('Uninstall “%s”?').format(this.extension.name),
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
            await this._manager.installRemoteExtension(this.uuid);
        } catch (e) {
            logError(e, `Installing '${this.uuid}'`);
        }
    }

    async _onUninstallActivated() {
        try {
            if (await this._confirmUninstall())
                await this._manager.uninstallExtension(this.uuid);
        } catch (e) {
            logError(e, `Uninstalling '${this.uuid}'`);
        }
    }

    async _onPrefsActivated() {
        try {
            await this._manager.launchExtensionPrefs(this.uuid);
        } catch (e) {
            logError(e);
        }
    }

    _onVersionsActivated() {
        if (this.info === null)
            return;

        const dialog = new VersionDialog({
            modal: true,
            title: this.info.name,
            transient_for: this.get_root(),
        });
        dialog.setInfo(this.info);
        dialog.present();
    }

    _onWebsiteActivated() {
        let url = null;

        if (this.info && this.info.url)
            url = this.info.url;

        if (this.extension && this.extension.url)
            url = this.extension.url;

        Gio.AppInfo.launch_default_for_uri(url,
            this.get_display().get_app_launch_context());
    }
});

