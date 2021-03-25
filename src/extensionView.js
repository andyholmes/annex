// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExtensionView */

const {Gio, GObject, Gtk} = imports.gi;
const {ExtensionInfo} = imports.ego;
const {ExtensionManager, ExtensionType, Extension} = imports.extensionSystem;


function _createLink(text, url) {
    return `<a href="${url}">${text}</a>`;
}


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
            Extension.$gtype
        ),
        'info': GObject.ParamSpec.object(
            'info',
            'Info',
            'Extension Info',
            GObject.ParamFlags.READWRITE,
            ExtensionInfo.$gtype
        ),
    },
}, class AnnexExtensionView extends Gtk.Box {
    _init(params = {}) {
        super._init(params);

        // Manager
        this._manager = ExtensionManager.getDefault();

        this._manager.connect('extension-added',
            this._onExtensionAdded.bind(this));

        this._manager.connect('extension-removed',
            this._onExtensionRemoved.bind(this));

        // Actions
        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('view', actionGroup);

        const action = new Gio.SimpleAction({
            name: 'website',
            enabled: true,
        });
        action.connect('activate',
            this._onWebsiteActivated.bind(this));
        actionGroup.add_action(action);

        this._installAction = new Gio.SimpleAction({
            name: 'install',
            enabled: false,
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

        if (extension === null) {
            this._installAction.enabled = true;
            this._uninstallAction.enabled = false;
            this._prefsAction.enabled = false;
        } else if (extension.type === ExtensionType.USER) {
            this._installAction.enabled = false;
            this._uninstallAction.enabled = true;
            this._prefsAction.enabled = extension.has_prefs;
        } else {
            this._installAction.enabled = false;
            this._uninstallAction.enabled = false;
            this._prefsAction.enabled = extension.has_prefs;
        }
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

        // Top bar
        this._iconImage.gicon = info.icon;
        this._nameLabel.label = info.name;
        this._creatorLabel.label = _createLink(info.creator, info.creator_url);

        // Screenshot
        if (info.screenshot) {
            this._screenshotPicture.file = info.screenshot;
            this._screenshotBox.visible = true;
        } else {
            this._screenshotPicture.file = null;
            this._screenshotBox.visible = false;
        }

        // Description
        this._descriptionLabel.label = info.description;

        this.extension = this._manager.lookupExtension(this.info.uuid);
    }

    _onExtensionAdded(_manager, uuid, extension) {
        if (this.info && this.info.uuid === uuid)
            this.extension = extension;
    }

    _onExtensionRemoved(_manager, uuid, _extension) {
        if (this.info && this.info.uuid === uuid)
            this.extension = null;
    }

    _confirmUninstall() {
        return new Promise((resolve, _reject) => {
            const dialog = new Gtk.MessageDialog({
                text: _('Uninstall Extension'),
                secondary_text: _('Uninstall “%s”?').format(this.info.name),
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
            await this._manager.installRemoteExtension(this.info.uuid);
        } catch (e) {
            logError(e, `Installing '${this.info.uuid}'`);
        }
    }

    async _onUninstallActivated() {
        try {
            if (await this._confirmUninstall())
                await this._manager.uninstallExtension(this.info.uuid);
        } catch (e) {
            logError(e, `Uninstalling '${this.info.uuid}'`);
        }
    }

    async _onPrefsActivated() {
        try {
            await this._manager.launchExtensionPrefs(this.info.uuid);
        } catch (e) {
            logError(e);
        }
    }

    _onWebsiteActivated() {
        let url = this.info.url;

        if (this.extension && this.extension.url)
            url = this.extension.url;

        Gio.AppInfo.launch_default_for_uri(url,
            this.get_display().get_app_launch_context());
    }
});

