// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported AnnexWindow */


const {GLib, Gio, GObject, Gtk} = imports.gi;

/* eslint-disable no-unused-vars */
const {ExtensionView} = imports.extensionView;
const {ExploreView} = imports.exploreView;
const {InstalledView} = imports.installedView;
const {SearchView} = imports.searchView;
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
        'searchView',
        'stack',
    ],
}, class AnnexWindow extends Gtk.ApplicationWindow {
    _init(application) {
        super._init({application});

        // GSettings
        this.settings = new Gio.Settings({
            schema_id: 'ca.andyholmes.Annex',
        });

        let action = this.settings.create_action('version-filter');
        this.add_action(action);

        // Actions
        action = new Gio.SimpleAction({
            name: 'previous',
            enabled: true,
        });
        action.connect('activate', this._onPrevious.bind(this));
        this.add_action(action);

        action = new Gio.SimpleAction({
            name: 'browse',
            enabled: true,
            parameter_type: new GLib.VariantType('s'),
        });
        action.connect('activate', this._onBrowse.bind(this));
        this.add_action(action);

        action = new Gio.SimpleAction({
            name: 'about',
            enabled: true,
        });
        action.connect('activate', this._aboutAction.bind(this));
        this.add_action(action);

        //
        this._searchButton.connect('notify::active',
            this._onSearchToggled.bind(this));
    }

    /*
     * Simple Navigation
     */
    _onTransitionRunning(_stack, _pspec) {
        const page = this._stack.visible_child_name;

        // Update the buttons during the transition
        if (this._stack.transition_running) {
            this._previousButton.visible = (page === 'view');
            this._searchButton.active = (page === 'search');

        // Update the extension view after the transition
        } else if (page !== 'view') {
            this._extensionView.extension = null;
            this._previousPage = null;
        }
    }

    _onBrowse(_action, parameter) {
        this._searchView._model.sort = parameter.unpack();
        this._searchButton.active = true;
    }

    _onExtensionSelected(page, info) {
        this._extensionView.info = info;

        this._previousPage = this._stack.visible_child_name;
        this._stack.visible_child_name = 'view';
    }

    _onPrevious() {
        this._stack.visible_child_name = this._previousPage;
        this._previousPage = null;
    }

    _onSearchToggled(button, _pspec) {
        if (button.active)
            this._stack.visible_child_name = 'search';
        else if (this._stack.visible_child_name !== 'view')
            this._stack.visible_child_name = this._previousPage || 'explore';

        this._previousPage = null;
    }

    _aboutAction(_action, _parameter) {
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
});

