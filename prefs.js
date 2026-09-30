// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MOD_KEYS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_ISO_Level3_Shift, Gdk.KEY_Caps_Lock, Gdk.KEY_Num_Lock,
]);

const SHIFT_NAMES = {
    exclam: '1',
    at: '2',
    numbersign: '3',
    dollar: '4',
    percent: '5',
    asciicircum: '6',
    ampersand: '7',
    asterisk: '8',
    parenleft: '9',
    parenright: '0',
};

function normalizeAccel(accel) {
    if (!accel)
        return '';
    let text = accel.replaceAll('<Control>', '<Primary>').replaceAll('<Ctl>', '<Primary>');
    for (const [name, digit] of Object.entries(SHIFT_NAMES)) {
        if (text.endsWith(name)) {
            text = text.slice(0, -name.length) + digit;
            break;
        }
    }
    const mods = [];
    for (const name of ['Primary', 'Alt', 'Super', 'Shift']) {
        const token = `<${name}>`;
        if (text.includes(token)) {
            mods.push(token);
            text = text.replaceAll(token, '');
        }
    }
    return mods.join('') + text.replaceAll('<', '').replaceAll('>', '');
}

function inhibitSystemShortcuts(widget) {
    try {
        widget.root.get_surface().inhibit_system_shortcuts(null);
        return true;
    } catch (_e) {
        return false;
    }
}

function restoreSystemShortcuts(widget) {
    try {
        widget.root.get_surface().restore_system_shortcuts();
    } catch (_e) {}
}

class ShortcutCapture extends Adw.Window {
    constructor({title, onPick}) {
        super({
            title,
            modal: true,
            default_width: 460,
            default_height: 240,
            resizable: false,
        });
        this._onPick = onPick;
        this._accel = '';
        this._inhibited = false;

        const header = new Adw.HeaderBar({show_end_title_buttons: false});
        const cancel = new Gtk.Button({label: 'Anuluj'});
        cancel.connect('clicked', () => this.close());
        header.pack_start(cancel);
        this._setBtn = new Gtk.Button({label: 'Ustaw', sensitive: false});
        this._setBtn.add_css_class('suggested-action');
        this._setBtn.connect('clicked', () => {
            if (this._accel)
                this._onPick(this._accel);
            this.close();
        });
        header.pack_end(this._setBtn);

        const toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(header);
        this.set_content(toolbar);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            valign: Gtk.Align.CENTER,
            margin_top: 16,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });
        const enter = new Gtk.Label({label: 'Wpisz nowy skrót'});
        enter.add_css_class('title-3');
        this._preview = new Gtk.ShortcutLabel({
            disabled_text: '…',
            accelerator: '',
            halign: Gtk.Align.CENTER,
        });
        const hint = new Gtk.Label({
            label: 'Esc anuluje    ·    Backspace wyłącza skrót',
            wrap: true,
        });
        hint.add_css_class('dim-label');
        box.append(enter);
        box.append(this._preview);
        box.append(hint);
        toolbar.set_content(box);

        const ctl = new Gtk.EventControllerKey();
        ctl.propagation_phase = Gtk.PropagationPhase.CAPTURE;
        ctl.connect('key-pressed', this._onKey.bind(this));
        this.add_controller(ctl);
        this.connect('map', () => {
            this._inhibited = inhibitSystemShortcuts(this);
        });
        this.connect('unmap', () => {
            if (this._inhibited)
                restoreSystemShortcuts(this);
            this._inhibited = false;
        });
    }

    _onKey(controller, keyval, keycode, state) {
        keyval = Gdk.keyval_to_lower(keyval);
        if (keyval === Gdk.KEY_Escape) {
            this.close();
            return true;
        }
        if (keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete) {
            this._onPick('');
            this.close();
            return true;
        }
        if (MOD_KEYS.has(keyval))
            return true;

        const mask = state & Gtk.accelerator_get_default_mod_mask();
        const explicit = Gtk.accelerator_get_default_mod_mask() | Gdk.ModifierType.SHIFT_MASK;
        try {
            const group = controller.get_group();
            const [, base] = this.display.translate_key(keycode, state & ~explicit, group);
            if (base)
                keyval = Gdk.keyval_to_lower(base);
        } catch (_e) {}

        const name = normalizeAccel(Gtk.accelerator_name(keyval, mask) || '');
        if (!name)
            return true;
        this._accel = name;
        this._preview.accelerator = name;
        this._setBtn.sensitive = Gtk.accelerator_valid(keyval, mask) || Boolean(mask);
        return true;
    }
}

function addShortcutRow(group, settings, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true});
    const chips = new Gtk.ShortcutLabel({
        disabled_text: 'Wyłączono',
        accelerator: (settings.get_strv(key) || [])[0] || '',
        halign: Gtk.Align.END,
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(chips);
    const clear = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Wyłącz skrót',
        visible: Boolean(chips.accelerator),
    });
    clear.add_css_class('flat');
    const apply = accel => {
        const value = accel ? [accel] : [];
        settings.set_strv(key, value);
        chips.accelerator = accel || '';
        clear.visible = Boolean(accel);
    };
    clear.connect('clicked', () => apply(''));
    row.add_suffix(clear);
    row.connect('activated', () => {
        const dlg = new ShortcutCapture({
            title,
            onPick: apply,
        });
        dlg.transient_for = row.get_root();
        dlg.present();
    });
    group.add(row);
}

export default class IskraDropdownPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Iskra',
            icon_name: 'input-keyboard-symbolic',
        });

        const keys = new Adw.PreferencesGroup({
            title: 'Skróty globalne',
            description: 'Kliknij wiersz, żeby zmienić skrót — tak samo jak w ddterm. Działa w całym GNOME.',
        });
        addShortcutRow(
            keys, settings, 'toggle-shortcut',
            'Przełącz okno Iskry',
            'Pokazuje albo chowa. Model zostaje na karcie.'
        );
        addShortcutRow(
            keys, settings, 'sleep-shortcut',
            'Zgaś model LLM',
            'Chowa Iskrę i zdejmuje model z VRAM, żeby zagrać.'
        );
        page.add(keys);

        const geo = new Adw.PreferencesGroup({title: 'Okno'});
        const height = new Adw.SpinRow({
            title: 'Wysokość (%)',
            adjustment: new Gtk.Adjustment({
                lower: 20,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: Math.round(settings.get_double('window-height') * 100),
            }),
        });
        height.connect('notify::value', () => {
            settings.set_double('window-height', height.value / 100);
        });
        const width = new Adw.SpinRow({
            title: 'Szerokość (%)',
            subtitle: 'Na ultrawide możesz dać mniej niż 100 — okno będzie na środku.',
            adjustment: new Gtk.Adjustment({
                lower: 30,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: Math.round(settings.get_double('window-width') * 100),
            }),
        });
        width.connect('notify::value', () => {
            settings.set_double('window-width', width.value / 100);
        });
        const anim = new Adw.SpinRow({
            title: 'Animacja (ms)',
            subtitle: '0 = bez zjazdu, od razu na miejscu.',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 800,
                step_increment: 20,
                page_increment: 100,
                value: settings.get_int('animation-ms'),
            }),
        });
        anim.connect('notify::value', () => {
            settings.set_int('animation-ms', Math.round(anim.value));
        });
        const above = new Adw.SwitchRow({
            title: 'Zawsze na wierzchu',
            subtitle: 'Widoczna Iskra zostaje nad innymi oknami.',
            active: settings.get_boolean('always-on-top'),
        });
        settings.bind('always-on-top', above, 'active', Gio.SettingsBindFlags.DEFAULT);
        const panel = new Adw.SwitchRow({
            title: 'Ikonka na pasku',
            subtitle: 'Iskra na górnym pasku. Klik — pokaż albo schowaj okno.',
            active: settings.get_boolean('show-panel-icon'),
        });
        settings.bind('show-panel-icon', panel, 'active', Gio.SettingsBindFlags.DEFAULT);
        geo.add(height);
        geo.add(width);
        geo.add(anim);
        geo.add(above);
        geo.add(panel);
        page.add(geo);

        window.add(page);
    }
}
