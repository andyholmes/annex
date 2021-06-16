// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported AnnexWindow */


const {GLib, Gio, GObject, Gtk} = imports.gi;

/* eslint-disable no-unused-vars */
const ExtensionInstaller = imports.extensionInstaller;
const {ExtensionView} = imports.extensionView;
const {ExploreView} = imports.exploreView;
const {InstalledView} = imports.installedView;
/* eslint-enable no-unused-vars */


var AnnexWindow = GObject.registerClass({
    GTypeName: 'AnnexWindow',
    Template: 'resource:///ca/andyholmes/Annex/ui/window.ui',
    InternalChildren: [
        'exploreView',
        'extensionView',
        'installedView',
        'previousButton',
        'searchButton',
        'stack',
    ],
}, class AnnexWindow extends Gtk.ApplicationWindow {
    _init(application) {
        super._init({application});

        // GSettings
        this.settings = new Gio.Settings({
            schema_id: 'ca.andyholmes.Annex',
        });

        const action = this.settings.create_action('version-filter');
        this.add_action(action);

        // Actions
        const actions = {
            about: [this._onAboutActivated, null],
            explore: [this._onExploreActivated, null],
            open: [this._onOpenActivated, null],
            previous: [this._onPreviousActivated, null],
            search: [this._onSearchActivated, new GLib.VariantType('s')],
            view: [this._onViewActivated, new GLib.VariantType('s')],
        };

        for (const [name, entry] of Object.entries(actions)) {
            const action = new Gio.SimpleAction({
                name: name,
                parameter_type: entry[1],
            });
            action.connect('activate', entry[0].bind(this));
            this.add_action(action);
        }
    }

    _onAboutActivated(_action, _parameter) {
        if (this._about === undefined) {
            this._about = new Gtk.AboutDialog({
                authors: [
                    'Andy Holmes <andrew.g.r.holmes@gmail.com>',
                ],
                translator_credits: _('translator-credits'),
                program_name: _('Annex'),
                comments: _('Install GNOME Extensions'),
                license_type: Gtk.License.GPL_2_0,
                logo_icon_name: pkg.name,
                version: pkg.version,
                hide_on_close: true,
                modal: true,
                transient_for: this,
            });
        }

        this._about.present();
    }

    _onExploreActivated(_action, _parameter) {
        this._searchButton.active = false;
        this._stack.set_visible_child_name('explore');
    }

    _onExtensionSelected(_page, uuid) {
        this._extensionView.uuid = uuid;

        this._previousPage = this._stack.visible_child_name;
        this._stack.visible_child_name = 'view';
    }

    async _onOpenActivated() {
        let installer;

        try {
            installer = new ExtensionInstaller.Dialog({
                application: this.application,
                modal: true,
                transient_for: this,
            });

            await installer.openFile();
            installer.present();
        } catch (e) {
            debug(e);
            installer.destroy();
        }
    }

    _onPreviousActivated() {
        this._stack.visible_child_name = this._previousPage;
        this._previousPage = null;
    }

    _onSearchActivated(_action, parameter) {
        debug();
        this._exploreView.search = parameter.unpack();
        this._searchButton.active = true;
    }

    _onSearchToggled(button, _pspec) {
        if (button.active) {
            this._stack.visible_child_name = 'explore';
            this._exploreView.search_mode_enabled = true;
            this._previousPage = null;
        }
    }

    _onTransitionRunning(_stack, _pspec) {
        const page = this._stack.visible_child_name;

        // Update the buttons during the transition
        if (this._stack.transition_running) {
            this._previousButton.visible = page === 'view';
            this._searchButton.visible = page === 'explore';

        // Update the extension view after the transition
        } else if (page !== 'view') {
            this._extensionView.uuid = null;
            this._previousPage = null;
        }
    }

    _onViewActivated(_action, parameter) {
        const uuid = parameter.unpack();
        this._extensionView.uuid = uuid;

        this._previousPage = this._stack.get_visible_child_name();
        this._stack.set_visible_child_name('view');
    }
});

