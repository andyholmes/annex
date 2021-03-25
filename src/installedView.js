// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported InstalledView */


const {Gio, GObject, Gtk} = imports.gi;
const {EGO, ExtensionInfo} = imports.ego;
const {ExtensionManager, Extension, ExtensionState, ExtensionType} = imports.extensionSystem;


const InstalledViewRow = GObject.registerClass({
    GTypeName: 'AnnexInstalledViewRow',
    Template: 'resource:///ca/andyholmes/Annex/ui/installed-view-row.ui',
    InternalChildren: [
        'iconImage',
        'nameLabel',
        'descriptionLabel',
        'enabledSwitch',
    ],
    Properties: {
        'extension': GObject.ParamSpec.object(
            'extension',
            'Extension',
            'The extension object',
            GObject.ParamFlags.READWRITE,
            Extension.$gtype
        ),
        'info': GObject.ParamSpec.object(
            'info',
            'Extension Info',
            'The extension info object',
            GObject.ParamFlags.READWRITE,
            ExtensionInfo.$gtype
        ),
    },
}, class AnnexInstalledViewRow extends Gtk.ListBoxRow {
    _init(extension) {
        super._init();

        this.extension = extension;
    }

    get extension() {
        if (this._extension === undefined)
            this._extension = null;

        return this._extension;
    }

    set extension(extension) {
        if (this.extension !== extension) {
            this._extension = extension;

            this._nameLabel.label = this.name;
            this._descriptionLabel.label = this.description.split('\n')[0];

            extension.connect('notify::state',
                this._onStateChanged.bind(this));
            this._onStateChanged(extension);
        }

        if (this.extension !== null) {
            const ego = EGO.getDefault();
            ego.lookupExtension(this.extension.uuid).then(info => {
                this.info = info;
            }).catch(() => {});
        }
    }

    get info() {
        if (this._info === undefined)
            this._info = null;

        return this._info;
    }

    set info(info) {
        if (this.info !== info) {
            this._info = info;
            this.notify('info');
        }

        if (this.info !== null) {
            this._iconImage.gicon = this.info.icon;
        }
    }

    get description() {
        if (this.extension === null)
            return null;

        return this.extension.description;
    }

    get name() {
        if (this.extension === null)
            return null;

        return this.extension.name;
    }

    get uuid() {
        if (this.extension === null)
            return null;

        return this.extension.uuid;
    }

    _onStateChanged(extension, _pspec) {
        switch (extension.state) {
            case ExtensionState.ENABLED:
                this._enabledSwitch.state = true;
                this._enabledSwitch.sensitive = true;
                break;

            case ExtensionState.DISABLED:
                this._enabledSwitch.state = false;
                this._enabledSwitch.sensitive = true;
                break;

            case ExtensionState.ERROR:
                this._enabledSwitch.sensitive = false;
                this._enabledSwitch.visible = false;
                break;
        }
    }

    async _onStateSet(widget, state) {
        const manager = ExtensionManager.getDefault();

        try {
            if (state === (this.extension.state === ExtensionState.ENABLED))
                return true;

            if (state)
                await manager.enableExtension(this.uuid);
            else
                await manager.disableExtension(this.uuid);
        } catch (e) {
            logError(e);
        }

        return true;
    }
});


var InstalledView = GObject.registerClass({
    GTypeName: 'AnnexInstalledView',
    Template: 'resource:///ca/andyholmes/Annex/ui/installed-view.ui',
    InternalChildren: [
        'userList',
        'systemList',
    ],
    Properties: {}, // model
    Signals: {
        'extension-selected': {
            param_types: [ExtensionInfo.$gtype],
        },
    },
}, class AnnexInstalledView extends Gtk.Box {
    _init() {
        super._init();

        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('search', actionGroup);

        this._userList.set_sort_func(this._sort);

        // Watch the manager
        this._manager = ExtensionManager.getDefault();

        this._manager.connect('extension-added',
            this._onExtensionAdded.bind(this));
        this._manager.connect('extension-removed',
            this._onExtensionRemoved.bind(this));

        for (const extension of this._manager.getExtensions())
            this._onExtensionAdded(this._manager, extension.uuid, extension);
    }

    _onExtensionAdded(_manager, _uuid, extension) {
        const row = new InstalledViewRow(extension);

        if (extension.type === ExtensionType.USER)
            this._userList.append(row);

        if (extension.type === ExtensionType.SYSTEM)
            this._systemList.append(row);
    }

    _onExtensionRemoved(_manager, uuid, _extension) {
        for (const row of this._userList) {
            if (row instanceof InstalledViewRow && row.uuid === uuid) {
                this._userList.remove(row);
                return;
            }
        }

        for (const row of this._systemList) {
            if (row instanceof InstalledViewRow && row.uuid === uuid) {
                this._systemList.remove(row);
                return;
            }
        }
    }

    async _onRowActivated(box, row) {
        try {
            const ego = EGO.getDefault();

            const info = await ego.lookupExtension(row.extension.uuid);
            this.emit('extension-selected', info);
        } catch (e) {
            logError(e);
        }
    }

    _sort(row1, row2) {
        return row1.name.localeCompare(row2.name);
    }

    _createRow(extension) {
        return new InstalledViewRow(extension);
    }
});

