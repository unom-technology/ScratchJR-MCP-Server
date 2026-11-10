// The browser bundle: the web tablet and account button, then ScratchJr itself,
// straight from the desktop app's source so the two stay the same program.
// ScratchJr waits for window.tablet (iOS.waitForInterface), which startTablet
// sets once the student's projects have loaded.

import './web.css';
import { css_vh, css_vw, scaleMultiplier } from '../../desktop/src/app/src/utils/lib.js';
import { startTablet } from './webTablet.js';
import { startAccountBar } from './accountBar.js';
import '../../desktop/src/app/appEntry.js';

// ScratchJr's stylesheets and help pages size themselves with ${css_vh(...)}
// expressions, which lib.js preprocess() runs through eval. Minifying renames
// these inside the bundle, so eval finds them here instead.
Object.assign(window, {css_vh, css_vw, scaleMultiplier});

startAccountBar();
startTablet();
