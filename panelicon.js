// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

function loadIskraIcon(extension) {
    const home = GLib.get_home_dir();
    const candidates = [
        GLib.build_filenamev([extension.path, 'icons', 'iskra.png']),
        GLib.build_filenamev([extension.path, 'icons', 'iskra.svg']),
        GLib.build_filenamev([home, '.local', 'share', 'icons', 'hicolor', '32x32', 'apps', 'dev.iskra.Iskra.png']),
        GLib.build_filenamev([home, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps', 'dev.iskra.Iskra.svg']),
    ];
    for (const path of candidates) {
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null))
            return new Gio.FileIcon({file});
    }
    return new Gio.ThemedIcon({name: 'dev.iskra.Iskra'});
}

export const IskraPanelButton = GObject.registerClass(
class IskraPanelButton extends PanelMenu.Button {
    _init(manager, extension) {
        super._init(0.5, 'Iskra', false);
        this._manager = manager;
        this._extension = extension;

        this.add_child(new St.Icon({
            gicon: loadIskraIcon(extension),
            style_class: 'system-status-icon iskra-panel-icon',
            icon_size: 16,
        }));

        const toggle = new PopupMenu.PopupMenuItem('Pokaż / ukryj okno');
        toggle.connect('activate', () => this._manager._toggle());
        this.menu.addMenuItem(toggle);

        const sleep = new PopupMenu.PopupMenuItem('Zgaś model LLM');
        sleep.connect('activate', () => this._manager._sleep());
        this.menu.addMenuItem(sleep);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefs = new PopupMenu.PopupMenuItem('Ustawienia');
        prefs.connect('activate', () => {
            try {
                this._extension.openPreferences();
            } catch (_e) {}
        });
        this.menu.addMenuItem(prefs);

        const quit = new PopupMenu.PopupMenuItem('Zakończ Iskrę');
        quit.connect('activate', () => this._manager._quit());
        this.menu.addMenuItem(quit);

        this.connect('button-press-event', (_actor, event) => {
            const button = event.get_button();
            if (button === Clutter.BUTTON_PRIMARY || button === Clutter.BUTTON_MIDDLE) {
                this.menu.close();
                this._manager._toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    setWindowVisible(visible) {
        if (visible)
            this.remove_style_class_name('iskra-panel-hidden');
        else
            this.add_style_class_name('iskra-panel-hidden');
    }
});
