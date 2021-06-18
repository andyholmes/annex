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
        'extensionIcon',
        'extensionName',
        'extensionDescription',
        'enabledSwitch',
        'statusIcon',
    ],
    Properties: {
        'description': GObject.ParamSpec.string(
            'description',
            'Description',
            'The extension description',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'extension': GObject.ParamSpec.object(
            'extension',
            'Extension',
            'The extension object',
            GObject.ParamFlags.READWRITE,
            Shell.Extension.$gtype
        ),
        'icon': GObject.ParamSpec.object(
            'icon',
            'Icon',
            'The extension icon',
            GObject.ParamFlags.READWRITE,
            Gio.Icon.$gtype
        ),
        'info': GObject.ParamSpec.object(
            'info',
            'Extension Info',
            'The extension info object',
            GObject.ParamFlags.READABLE,
            Ego.ExtensionInfo.$gtype
        ),
        'uuid': GObject.ParamSpec.string(
            'uuid',
            'UUID',
            'The extension UUID',
            GObject.ParamFlags.READWRITE,
            null
        ),
    },
}, class AnnexInstalledViewRow extends Gtk.ListBoxRow {
    _init(extension) {
        super._init();

        this.bind_property('name', this._extensionName, 'label',
            GObject.BindingFlags.SYNC_CREATE |
            GObject.BindingFlags.BIDIRECTIONAL);

        this.extension = extension;
    }

    get description() {
        return this._extensionDescription.label;
    }

    set description(text) {
        this._extensionDescription.label = text.split('\n')[0];
    }

    get extension() {
        if (this._extension === undefined)
            this._extension = null;

        return this._extension;
    }

    set extension(extension) {
        if (this.extension === extension)
            return;

        extension.bind_property('description', this, 'description',
            GObject.BindingFlags.SYNC_CREATE);
        extension.bind_property('name', this, 'name',
            GObject.BindingFlags.SYNC_CREATE);
        extension.bind_property('uuid', this, 'uuid',
            GObject.BindingFlags.SYNC_CREATE);
        extension.connect('notify::state',
            this._onStateChanged.bind(this));

        this._extension = extension;
        this.notify('extension');

        this._onStateChanged();
        this._update();
    }

    get icon() {
        return this._extensionIcon.gicon;
    }

    set icon(icon) {
        if (icon === null)
            icon = new Gio.ThemedIcon({name: 'ego-plugin'});

        this._extensionIcon.gicon = icon;
    }

    get info() {
        if (this._info === undefined)
            this._info = null;

        return this._info;
    }

    _onStateChanged(_extension, _pspec) {
        switch (this.extension.state) {
            case Shell.ExtensionState.ENABLED:
                this._enabledSwitch.state = true;
                this._enabledSwitch.sensitive = true;
                this._statusIcon.visible = false;
                break;

            case Shell.ExtensionState.DISABLED:
                this._enabledSwitch.state = false;
                this._enabledSwitch.sensitive = true;
                this._statusIcon.visible = false;
                break;

            case Shell.ExtensionState.OUT_OF_DATE:
                this._statusIcon.icon_name = 'dialog-warning-symbolic';
                this._statusIcon.tooltip_text = _('Update Required');
                this._statusIcon.visible = true;
                break;

            case Shell.ExtensionState.ERROR:
                this._enabledSwitch.sensitive = false;
                this._statusIcon.icon_name = 'dialog-error-symbolic';
                this._statusIcon.tooltip_text = this.extension.error;
                this._statusIcon.visible = true;
                break;

            case Shell.ExtensionState.UNINSTALLED:
                this._enabledSwitch.sensitive = false;
                this._statusIcon.icon_name = 'dialog-error-symbolic';
                this._statusIcon.tooltip_text = this.extension.error;
                this._statusIcon.visible = true;
                break;
        }

        // The extension can be updated
        if (this.extension.can_update) {
            this._statusIcon.icon_name = 'software-update-available-symbolic';
            this._statusIcon.tooltip_text = _('Update Available');
            this._statusIcon.visible = true;

        // The extension has an update pending
        } else if (this.extension.has_update) {
            this._statusIcon.icon_name = 'view-refresh-symbolic';
            this._statusIcon.tooltip_text = _('Update Available');
            this._statusIcon.visible = true;
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
            const info = await repository.lookup(this.uuid);

            if (info && info.uuid === this.uuid) {
                info.bind_property('description', this, 'description',
                    GObject.BindingFlags.SYNC_CREATE);
                info.bind_property('icon', this, 'icon',
                    GObject.BindingFlags.SYNC_CREATE);
                info.bind_property('name', this, 'name',
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
        const rows = [...this._userList, ...this._systemList];

        for (const row of rows) {
            if (row instanceof InstalledViewRow && row.uuid === uuid) {
                row.get_ancestor(Gtk.ListBox.$gtype).remove(row);
                return;
            }
        }
    }

    _onKeynavFailed(widget, dir) {
        let child = null;

        /* Navigating down towards the system list */
        if (widget === this._userList && dir === Gtk.DirectionType.DOWN) {
            child = this._systemList.get_first_child();

            if (child === this._systemPlaceholder)
                child = child.get_next_sibling();
        }

        /* Navigating up towards the user list */
        if (widget === this._systemList && dir === Gtk.DirectionType.UP) {
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
        // NOTE: comparing row1 => row2 for ascending sort
        return row1.name.localeCompare(row2.name);
    }

    _createRow(extension) {
        return new InstalledViewRow(extension);
    }
});

