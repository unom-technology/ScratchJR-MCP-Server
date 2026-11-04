import ScratchJr from '../editor/ScratchJr';
import Alert from '../editor/ui/Alert';
import IO from '../iPad/IO';
import iOS from '../iPad/iOS';

// Desktop only: saving the open project to a .sjr file on the computer, and
// loading one back in. main.js owns the File menu and the file dialogs; this
// is the half that knows which project is open and how to pack and unpack it.
// The file is the same .sjr archive the tablet apps share, so a project can
// travel between this app and ScratchJr on an iPad or Android tablet.

// Pages that can take a request; the in-app help frames cannot.
const pages = ['index', 'home', 'editor', 'gettingStarted'];

export default class ProjectFile {
    static listen (page) {
        page = page || 'index';
        if (pages.indexOf(page) < 0 || !window.tablet.setProjectFileHandlers) {
            return;
        }
        window.tablet.setProjectFileHandlers({
            save: function () {
                ProjectFile.save(page);
            },
            load: function (file) {
                ProjectFile.load(page, file);
            }
        });
    }

    static save (page) {
        if (page != 'editor' || !ScratchJr.currentProject) {
            ProjectFile.report('save', 'Open a project first, then save it to your computer.');
            return;
        }
        if (!ScratchJr.isEditable()) {
            ProjectFile.report('save', 'Sample projects can\'t be saved. Make a project of your own to save it to your computer.');
            return;
        }

        // Same order as UI.infoDoShare: stop the scripts, save what is on the
        // screen, then pack what is now in the database.
        ScratchJr.onHold = true; // Freeze the editing UI
        try {
            ScratchJr.stopStrips();
            ScratchJr.saveProject(null, function () {
                try {
                    IO.zipProject(ScratchJr.currentProject, function (contents) {
                        Alert.close();
                        ScratchJr.onHold = false; // Unfreeze the editing UI
                        iOS.sendSjrToShareDialog(IO.zipFileName, IO.shareName, '', 0, contents);
                    });
                } catch (err) {
                    ProjectFile.unfreeze();
                    ProjectFile.report('save', 'This project could not be saved to your computer.', err);
                }
            });
        } catch (err) {
            ProjectFile.unfreeze();
            ProjectFile.report('save', 'This project could not be saved to your computer.', err);
        }
    }

    // file: {fileName, data} where data is the base64 contents of the .sjr
    static load (page, file) {
        var keepOpenProject = function (next) {
            next();
        };
        if (page == 'editor') {
            // Whatever is open is saved first, since the page is left afterwards.
            keepOpenProject = function (next) {
                ScratchJr.onHold = true;
                ScratchJr.stopStrips();
                ScratchJr.saveProject(null, next);
            };
        }

        try {
            keepOpenProject(function () {
                IO.loadProjectFromSjr(file.data).then(function () {
                    ProjectFile.report('load', null, null, file.fileName);
                    // The lobby refreshes itself; anywhere else, go and show the
                    // new project, which arrives with a gift bow on it.
                    if (page != 'home') {
                        window.location.href = 'home.html?place=home';
                    }
                }).catch(function (err) {
                    ProjectFile.unfreeze();
                    ProjectFile.report('load', 'This file could not be loaded. It may not be a ScratchJr project, or it may be damaged.', err, file.fileName);
                });
            });
        } catch (err) {
            ProjectFile.unfreeze();
            ProjectFile.report('load', 'This file could not be loaded.', err, file.fileName);
        }
    }

    static unfreeze () {
        Alert.close();
        ScratchJr.onHold = false;
    }

    // Tells main.js how a request ended; it shows the message, if there is one.
    static report (action, message, err, fileName) {
        window.tablet.projectFileResult({
            action: action,
            fileName: fileName,
            error: message || undefined,
            detail: err ? String(err.message || err) : undefined
        });
    }
}
