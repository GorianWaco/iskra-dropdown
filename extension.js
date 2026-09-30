// SPDX-License-Identifier: GPL-2.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {IskraDropManager} from './manager.js';

export default class IskraDropdown extends Extension {
    enable() {
        this._manager = new IskraDropManager(this);
        this._manager.enable();
    }

    disable() {
        this._manager?.disable();
        this._manager = null;
    }
}
