// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported InstalledView */


const {Gio, GObject, Gtk} = imports.gi;

const Ego = imports.ego;
const Shell = imports.shell;


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
            Shell.Extension.$gtype
        ),
        'info': GObject.ParamSpec.object(
            'info',
            'Extension Info',
            'The extension info object',
            GObject.ParamFlags.READWRITE,
            Ego.ExtensionInfo.$gtype
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
        if (this.extension === extension)
            return;

        this._nameLabel.label = extension.name;
        this._descriptionLabel.label = extension.description.split('\n')[0];

        extension.connect('notify::state',
            this._onStateChanged.bind(this));
        this._onStateChanged(extension);

        this._extension = extension;
        this.notify('extension');

        this._update();
    }

    get info() {
        if (this._info === undefined)
            this._info = null;

        return this._info;
    }

    set info(info) {
        if (this.info === info)
            return;

        if (info && info.icon)
            this._iconImage.gicon = info.icon;
        else
            this._iconImage.gicon = new Gio.ThemedIcon({name: 'ego-plugin'});

        this._info = info;
        this.notify('info');
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
            case Shell.ExtensionState.ENABLED:
                this._enabledSwitch.state = true;
                this._enabledSwitch.sensitive = true;
                break;

            case Shell.ExtensionState.DISABLED:
                this._enabledSwitch.state = false;
                this._enabledSwitch.sensitive = true;
                break;

            case Shell.ExtensionState.ERROR:
                this._enabledSwitch.sensitive = false;
                this._enabledSwitch.visible = false;
                break;
        }
    }

    async _onStateSet(widget, state) {
        const manager = Shell.ExtensionManager.getDefault();

        try {
            if (state === (this.extension.state === Shell.ExtensionState.ENABLED))
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

    async _update() {
        if (this.extension) {
            try {
                const repository = Ego.Repository.getDefault();
                const info = await repository.lookupExtension(this.uuid);

                if (info && info.uuid === this.uuid)
                    this.info = info;
            } catch (e) {
                // Silence errors
            }
        }
    }
});


var InstalledView = GObject.registerClass({
    GTypeName: 'AnnexInstalledView',
    Template: 'resource:///ca/andyholmes/Annex/ui/installed-view.ui',
    InternalChildren: [
        'userList',
        'systemList',
    ],
    Signals: {
        'extension-selected': {
            param_types: [GObject.TYPE_STRING],
        },
    },
}, class AnnexInstalledView extends Gtk.Box {
    _init() {
        super._init();

        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('search', actionGroup);

        this._systemList.set_sort_func(this._sort);
        this._userList.set_sort_func(this._sort);

        // Watch the manager
        this._manager = Shell.ExtensionManager.getDefault();

        this._manager.connect('extension-added',
            this._onExtensionAdded.bind(this));
        this._manager.connect('extension-removed',
            this._onExtensionRemoved.bind(this));

        for (const extension of this._manager.listExtensions())
            this._onExtensionAdded(this._manager, extension.uuid, extension);
    }

    _onExtensionAdded(_manager, _uuid, extension) {
        const row = new InstalledViewRow(extension);

        if (extension.type === Shell.ExtensionType.USER)
            this._userList.append(row);

        if (extension.type === Shell.ExtensionType.SYSTEM)
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

    _onRowActivated(_box, row) {
        this.emit('extension-selected', row.uuid);
    }

    _sort(row1, row2) {
        return row1.name.localeCompare(row2.name);
    }

    _createRow(extension) {
        return new InstalledViewRow(extension);
    }
});

