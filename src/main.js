// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported main */


/* eslint-disable-next-line no-restricted-properties */
pkg.initFormat();
pkg.initGettext();
pkg.require({
    'Gio': '2.0',
    'GLib': '2.0',
    'GObject': '2.0',
    'Gtk': '4.0',
    'Soup': '2.4',
});

const {Gio, GLib, GObject, Gdk, Gtk} = imports.gi;

const {AnnexWindow} = imports.window;
const ExtensionInstaller = imports.extensionInstaller;
const Utils = imports.utils;


/**
 * The primary application class for Annex.
 */
const Application = GObject.registerClass({
    GTypeName: 'AnnexApplication',
}, class AnnexApplication extends Gtk.Application {
    _init() {
        super._init({
            application_id: 'ca.andyholmes.Annex',
            flags: Gio.ApplicationFlags.HANDLES_OPEN,
        });
    }

    _ensureMainWindow() {
        for (const window of this.get_windows()) {
            if (window instanceof AnnexWindow)
                return window;
        }

        return new AnnexWindow(this);
    }

    _onQuitActivated(_action, _parameter) {
        this.quit();

    }

    _windowAction(action, parameter) {
        const window = this._ensureMainWindow();

        if (window)
            window.activate_action(action.name, parameter);
    }

    vfunc_activate() {
        const window = this._ensureMainWindow();

        if (window)
            window.present();
    }

    vfunc_open(files, hint) {
        super.vfunc_open(files, hint);

        for (const file of files) {
            try {
                const installer = new ExtensionInstaller.Dialog({
                    application: this,
                    file: file,
                });
                installer.present();
            } catch (e) {
                logError(e, file.get_basename());
            }
        }
    }

    vfunc_startup() {
        super.vfunc_startup();

        // Actions
        try {
            const actions = {
                explore: [this._windowAction, null],
                open: [this._windowAction, null],
                quit: [this._onQuitActivated, null],
                search: [this._windowAction, new GLib.VariantType('s')],
                view: [this._windowAction, new GLib.VariantType('s')],
            };

            for (const [name, entry] of Object.entries(actions)) {
                const [activate, parameterType] = entry;
                const action = new Gio.SimpleAction({
                    name: name,
                    parameter_type: parameterType,
                });
                action.connect('activate', activate.bind(this));
                this.add_action(action);
            }
        } catch (e) {
            logError(e);
        }

        // CSS
        try {
            const provider = new Gtk.CssProvider();
            provider.load_from_resource(
                '/ca/andyholmes/Annex/css/application.css');

            const display = Gdk.Display.get_default();
            Gtk.StyleContext.add_provider_for_display(display, provider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        } catch (e) {
            logError(e);
        }
    }
});


function main(argv) {
    const application = new Application();

    Utils.initLogging();

    return application.run(argv);
}
