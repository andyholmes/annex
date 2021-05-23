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
        'errorImage',
        'updateImage',
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
            GObject.ParamFlags.READABLE,
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

        extension.bind_property('name', this._nameLabel, 'label',
            GObject.BindingFlags.SYNC_CREATE);
        extension.bind_property('description', this._descriptionLabel, 'label',
            GObject.BindingFlags.SYNC_CREATE);
        extension.bind_property('has-update', this._updateImage, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        extension.connect('notify::state',
            this._onStateChanged.bind(this));

        this._extension = extension;
        this.notify('extension');

        this._onStateChanged();
        this._update();
    }

    get info() {
        if (this._info === undefined)
            this._info = null;

        return this._info;
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

    _onStateChanged(_extension, _pspec) {
        switch (this.extension.state) {
            case Shell.ExtensionState.ENABLED:
                this._enabledSwitch.state = true;
                this._enabledSwitch.sensitive = true;
                this._errorImage.visible = false;
                break;

            case Shell.ExtensionState.DISABLED:
                this._enabledSwitch.state = false;
                this._enabledSwitch.sensitive = true;
                this._errorImage.visible = false;
                break;

            case Shell.ExtensionState.OUT_OF_DATE:
            case Shell.ExtensionState.ERROR:
                this._enabledSwitch.sensitive = false;
                this._errorImage.icon_name = 'dialog-error-symbolic';
                this._errorImage.tooltip_text = this.extension.error;
                this._errorImage.visible = true;
                break;
        }
    }

    _onStateSet(widget, state) {
        /* Check if this is a no-op */
        const enabled = this.extension.state === Shell.ExtensionState.ENABLED;

        if (enabled === state)
            return false;

        /* Try to toggle the extension */
        const manager = Shell.ExtensionManager.getDefault();

        if (state)
            manager.enableExtension(this.uuid).catch(warning);
        else
            manager.disableExtension(this.uuid).catch(warning);

        return true;
    }

    async _update() {
        if (this.extension && this.info === null) {
            const repository = Ego.Repository.getDefault();
            const info = await repository.lookupExtension(this.uuid);

            if (info && info.uuid === this.uuid) {
                info.bind_property('icon', this._iconImage, 'gicon',
                    GObject.BindingFlags.SYNC_CREATE);
                info.bind_property('name', this._nameLabel, 'label',
                    GObject.BindingFlags.SYNC_CREATE);
                info.bind_property('description', this._descriptionLabel, 'label',
                    GObject.BindingFlags.SYNC_CREATE);

                this._info = info;
                this.notify('info');
            }
        }
    }
});


var InstalledView = GObject.registerClass({
    GTypeName: 'AnnexInstalledView',
    Template: 'resource:///ca/andyholmes/Annex/ui/installed-view.ui',
    InternalChildren: [
        'userList',
        'userPlaceholder',
        'systemList',
        'systemPlaceholder',
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

    _onKeynavFailed(widget, dir) {
        let child = null;

        if (widget === this._userList && dir === Gtk.DirectionType.DOWN) {
            child = this._systemList.get_first_child();

            if (child === this._systemPlaceholder)
                child = child.get_next_sibling();
        } else if (widget === this._systemList && dir === Gtk.DirectionType.UP) {
            child = this._userList.get_last_child();

            if (child === this._userPlaceholder)
                child = child.get_prev_sibling();
        }

        if (child)
            return child.grab_focus();

        return false;
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

