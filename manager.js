// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {IskraPanelButton} from './panelicon.js';

const APP_ID = 'dev.iskra.Iskra';
const APP_PATH = '/dev/iskra/Iskra';
const SCHEMA_ID = 'org.gnome.shell.extensions.iskra-dropdown';
const EXT_UUID = 'iskra-dropdown@gorian';
const CUSTOM_TOGGLE =
    '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/iskra-dropdown/';
const CUSTOM_SLEEP =
    '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/iskra-sleep/';

function currentTime() {
    try {
        return global.get_current_time();
    } catch (_e) {
        return global.display.get_current_time_roundtrip();
    }
}

function unmaximize(win) {
    try {
        if (win.set_unmaximize_flags)
            win.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
        else if (win.unmaximize)
            win.unmaximize(Meta.MaximizeFlags.BOTH);
    } catch (_e) {}
}

export function loadSettings() {
    const dir = GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local',
        'share',
        'gnome-shell',
        'extensions',
        EXT_UUID,
        'schemas',
    ]);
    const source = Gio.SettingsSchemaSource.new_from_directory(
        dir,
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const schema = source.lookup(SCHEMA_ID, false);
    if (!schema)
        throw new Error(`Brak schematu ${SCHEMA_ID}`);
    return new Gio.Settings({settings_schema: schema});
}

export function iskraExtensionActive() {
    try {
        const ext = Main.extensionManager?.lookup?.(EXT_UUID);
        if (!ext)
            return false;
        return ext.state === 1;
    } catch (_e) {
        return false;
    }
}

export class IskraDropManager {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
    }

    enable() {
        if (globalThis._iskraDropActive) {
            log('Iskra drop-down: już aktywny, pomijam');
            return;
        }
        globalThis._iskraDropActive = true;
        this._running = false;
        this._busy = false;
        this._hiding = false;
        this._applyingAbove = false;
        this._aboveWatches = new Map();
        this._panelButton = null;

        this._watch = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            APP_ID,
            Gio.BusNameWatcherFlags.NONE,
            () => {
                this._running = true;
                this._syncPanelIcon();
            },
            () => {
                this._running = false;
                this._syncPanelIcon();
            }
        );
        this._panelSettingId = this._settings.connect('changed::show-panel-icon', () => {
            this._syncPanelIcon();
        });

        this._removeCustomMediaKeys();
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            modes,
            () => this._toggle()
        );
        Main.wm.addKeybinding(
            'sleep-shortcut',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            modes,
            () => this._sleep()
        );

        this._aboveSettingsId = this._settings.connect('changed::always-on-top', () => {
            this._applyAbove(this._find());
        });
        this._focusId = global.display.connect('notify::focus-window', () => {
            const win = this._find();
            if (win && !win.minimized && win.get_compositor_private())
                this._applyAbove(win);
        });
        this._mapId = global.window_manager.connect('map', (_wm, actor) => {
            const win = actor.meta_window || actor.get_meta_window?.();
            if (!this._isMain(win))
                return;
            this._onMapped(win, actor);
        });
        this._unmanageId = global.window_manager.connect('destroy', (_wm, actor) => {
            const win = actor?.meta_window || actor?.get_meta_window?.();
            if (this._isMain(win)) {
                actor.translation_y = 0;
                this._updatePanelState();
            }
        });

        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window || actor.get_meta_window?.();
            if (this._isMain(win) && !win.minimized)
                this._snap(win);
        }
        this._syncPanelIcon();
    }

    disable() {
        this._removePanelIcon();
        if (this._panelSettingId && this._settings) {
            this._settings.disconnect(this._panelSettingId);
            this._panelSettingId = 0;
        }
        try {
            Main.wm.removeKeybinding('toggle-shortcut');
            Main.wm.removeKeybinding('sleep-shortcut');
        } catch (_e) {}
        this._restoreCustomMediaKeys();
        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = 0;
        }
        if (this._unmanageId) {
            global.window_manager.disconnect(this._unmanageId);
            this._unmanageId = 0;
        }
        if (this._focusId) {
            global.display.disconnect(this._focusId);
            this._focusId = 0;
        }
        if (this._aboveSettingsId && this._settings) {
            this._settings.disconnect(this._aboveSettingsId);
            this._aboveSettingsId = 0;
        }
        if (this._watch) {
            Gio.bus_unwatch_name(this._watch);
            this._watch = 0;
        }
        for (const [win, hid] of this._aboveWatches || []) {
            try {
                win.disconnect(hid);
            } catch (_e) {}
        }
        this._aboveWatches = new Map();
        this._settings = null;
        this._extension = null;
        globalThis._iskraDropActive = false;
    }

    _windowVisible() {
        const win = this._find();
        return Boolean(win && !win.minimized && win.get_compositor_private() && !this._hiding);
    }

    _wantsPanelIcon() {
        try {
            return Boolean(this._settings?.get_boolean('show-panel-icon'));
        } catch (_e) {
            return true;
        }
    }

    _syncPanelIcon() {
        const want = this._wantsPanelIcon();
        if (want)
            this._ensurePanelIcon();
        else
            this._removePanelIcon();
        this._updatePanelState();
    }

    _ensurePanelIcon() {
        if (this._panelButton || !this._extension)
            return;
        try {
            Main.panel.statusArea['iskra-dropdown']?.destroy();
        } catch (_e) {}
        try {
            this._panelButton = new IskraPanelButton(this, this._extension);
            Main.panel.addToStatusArea('iskra-dropdown', this._panelButton, 1, 'right');
        } catch (e) {
            logError(e, 'Iskra drop-down: nie mogę dodać ikony na pasek');
            try {
                this._panelButton?.destroy();
            } catch (_e) {}
            this._panelButton = null;
            return;
        }
        this._updatePanelState();
    }

    _removePanelIcon() {
        if (!this._panelButton)
            return;
        this._panelButton.destroy();
        this._panelButton = null;
    }

    _updatePanelState() {
        this._panelButton?.setWindowVisible(this._windowVisible());
    }

    _quit() {
        if (this._running)
            this._call('quit', false);
    }

    _isMain(win) {
        if (!win)
            return false;
        try {
            if (win.get_transient_for())
                return false;
        } catch (_e) {}
        try {
            const type = win.get_window_type();
            if (type !== Meta.WindowType.NORMAL)
                return false;
        } catch (_e) {}
        let gtkId = '';
        try {
            gtkId = win.gtk_application_id || win.get_gtk_application_id?.() || '';
        } catch (_e) {}
        if (gtkId === APP_ID)
            return true;
        const wm = `${win.get_wm_class?.() || ''} ${win.get_wm_class_instance?.() || ''}`.toLowerCase();
        return wm.includes('iskra');
    }

    _find() {
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window || actor.get_meta_window?.();
            if (this._isMain(win))
                return win;
        }
        return null;
    }

    _toggle() {
        if (this._busy)
            return;
        const win = this._find();
        if (win && !win.minimized && win.get_compositor_private()) {
            if (win.has_focus()) {
                this._hideAnimated(win);
                return;
            }
            try {
                win.activate(currentTime());
                this._snap(win);
            } catch (_e) {
                this._call('show-window', true);
            }
            this._updatePanelState();
            return;
        }
        this._show();
    }

    _show() {
        if (this._running)
            this._call('show-window', true);
        else
            this._launch();
    }

    _sleep() {
        if (this._running)
            this._call('sleep-gpu', false);
    }

    _onMapped(win, actor) {
        if (this._hiding)
            return;
        this._snap(win);
        const ms = this._settings.get_int('animation-ms');
        try {
            Main.wm.skipNextEffect(actor);
        } catch (_e) {}
        if (ms <= 0) {
            actor.translation_y = 0;
            this._activate(win);
            this._updatePanelState();
            return;
        }
        const dist = Math.max(actor.height, win.get_frame_rect().height, 1);
        actor.remove_all_transitions();
        actor.translation_y = -dist;
        actor.ease({
            translation_y: 0,
            duration: ms,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this._activate(win);
        this._updatePanelState();
    }

    _hideAnimated(win) {
        const actor = win.get_compositor_private();
        const ms = this._settings.get_int('animation-ms');
        if (!actor || ms <= 0) {
            this._call('hide-window');
            return;
        }
        this._busy = true;
        this._hiding = true;
        try {
            Main.wm.skipNextEffect(actor);
        } catch (_e) {}
        const dist = Math.max(actor.height, 1);
        actor.remove_all_transitions();
        actor.ease({
            translation_y: -dist,
            duration: ms,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: () => {
                actor.translation_y = 0;
                this._call('hide-window');
                this._busy = false;
                this._hiding = false;
                this._updatePanelState();
            },
        });
    }

    _snap(win) {
        unmaximize(win);
        const monitor = global.display.get_current_monitor();
        try {
            if (win.get_monitor() !== monitor)
                win.move_to_monitor(monitor);
        } catch (_e) {}
        const work = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const heightPct = this._settings.get_double('window-height');
        const widthPct = this._settings.get_double('window-width');
        const width = Math.max(640, Math.round(work.width * widthPct));
        const height = Math.max(360, Math.round(work.height * heightPct));
        const x = work.x + Math.round((work.width - width) / 2);
        const y = work.y;
        try {
            win.move_resize_frame(false, x, y, width, height);
        } catch (_e) {}
        this._applyAbove(win);
        try {
            win.stick();
        } catch (_e) {}
    }

    _isAbove(win) {
        try {
            if (typeof win.above === 'boolean')
                return win.above;
        } catch (_e) {}
        try {
            if (win.is_above)
                return Boolean(win.is_above());
        } catch (_e) {}
        return false;
    }

    _applyAbove(win) {
        if (!win || !this._settings || this._applyingAbove)
            return;
        const want = this._settings.get_boolean('always-on-top');
        const isAbove = this._isAbove(win);
        if (isAbove === want)
            return;
        this._applyingAbove = true;
        try {
            if (want) {
                try {
                    win.unmake_above();
                } catch (_e) {}
                win.make_above();
            } else {
                win.unmake_above();
            }
        } catch (_e) {
        } finally {
            this._applyingAbove = false;
        }
        if (!this._aboveWatches.has(win)) {
            try {
                const hid = win.connect('notify::above', () => {
                    if (!this._settings)
                        return;
                    if (this._settings.get_boolean('always-on-top') && !this._isAbove(win))
                        this._applyAbove(win);
                });
                this._aboveWatches.set(win, hid);
            } catch (_e) {}
        }
    }

    _activate(win) {
        try {
            win.activate(currentTime());
        } catch (_e) {}
    }

    _call(action, launchIfMissing = false) {
        Gio.DBus.session.call(
            APP_ID,
            APP_PATH,
            'org.freedesktop.Application',
            'ActivateAction',
            new GLib.Variant('(sava{sv})', [action, [], {}]),
            null,
            Gio.DBusCallFlags.NONE,
            2500,
            null,
            (_conn, res) => {
                try {
                    Gio.DBus.session.call_finish(res);
                } catch (_e) {
                    if (launchIfMissing)
                        this._launch();
                }
            }
        );
    }

    _launch() {
        try {
            const info = Gio.DesktopAppInfo.new('dev.iskra.Iskra.desktop');
            if (info) {
                info.launch([], null);
                return;
            }
        } catch (_e) {}
        const bin = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'iskra']);
        try {
            Gio.Subprocess.new([bin], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'Iskra drop-down: nie mogę uruchomić Iskry');
        }
    }

    _removeCustomMediaKeys() {
        try {
            const media = new Gio.Settings({
                schema_id: 'org.gnome.settings-daemon.plugins.media-keys',
            });
            const skip = new Set([CUSTOM_TOGGLE, CUSTOM_SLEEP]);
            const list = media.get_strv('custom-keybindings').filter(p => !skip.has(p));
            media.set_strv('custom-keybindings', list);
        } catch (_e) {}
    }

    _restoreCustomMediaKeys() {
        try {
            const toggle = (this._settings.get_strv('toggle-shortcut') || [])[0] || '';
            const sleep = (this._settings.get_strv('sleep-shortcut') || [])[0] || '';
            const exe = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'iskra']);
            const media = new Gio.Settings({
                schema_id: 'org.gnome.settings-daemon.plugins.media-keys',
            });
            const list = media.get_strv('custom-keybindings');
            const add = [];
            if (toggle && !list.includes(CUSTOM_TOGGLE))
                add.push(CUSTOM_TOGGLE);
            if (sleep && !list.includes(CUSTOM_SLEEP))
                add.push(CUSTOM_SLEEP);
            if (add.length)
                media.set_strv('custom-keybindings', [...list, ...add]);
            if (toggle)
                this._writeCustom(CUSTOM_TOGGLE, 'Iskra — okno', `${exe} --toggle`, toggle);
            if (sleep)
                this._writeCustom(CUSTOM_SLEEP, 'Iskra — zgaś model', `${exe} --sleep`, sleep);
        } catch (_e) {}
    }

    _writeCustom(path, name, command, binding) {
        const kb = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
            path,
        });
        kb.set_string('name', name);
        kb.set_string('command', command);
        kb.set_string('binding', binding);
    }
}
