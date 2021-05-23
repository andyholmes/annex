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

const {Gio, GObject, Gdk, Gtk} = imports.gi;

const {AnnexWindow} = imports.window;
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
            flags: Gio.ApplicationFlags.FLAGS_NONE,
        });
    }

    vfunc_activate() {
        let activeWindow = this.activeWindow;

        if (!activeWindow)
            activeWindow = new AnnexWindow(this);

        activeWindow.present();
    }

    vfunc_startup() {
        super.vfunc_startup();

        try {
            const display = Gdk.Display.get_default();
            const provider = new Gtk.CssProvider();

            provider.load_from_resource(
                '/ca/andyholmes/Annex/css/application.css');
            Gtk.StyleContext.add_provider_for_display(display,
                provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        } catch (e) {
            logError(e, 'Loading CSS');
        }
    }
});


function main(argv) {
    const application = new Application();

    Utils.initLogging();

    return application.run(argv);
}
