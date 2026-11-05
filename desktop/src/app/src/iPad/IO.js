import JSZip from 'jszip';

import iOS from './iOS';
import MediaLib from './MediaLib';
import {setCanvasSize, drawThumbnail, gn} from '../utils/lib';
import Lobby from '../lobby/Lobby';
import SVG2Canvas from '../utils/SVG2Canvas';

const database = 'projects';
const collectLibraryAssets = false;

// Sharing state
let zipFile = null;
let zipAssetsExpected = 0;
let zipAssetsActual = 0;
let zipFileName = '';
let shareName = '';

export default class IO {
    static get zipFileName () {
        return zipFileName;
    }

    static get shareName () {
        return shareName;
    }

    /**
     * Synchronous requests are normally not recommended, but in this case we're
     * going to file URLs so this should be okay.
     */
    static requestSynchronous (url) {
        var request = new XMLHttpRequest();
        request.open('GET', url, false);
        request.send(null);
        if (request.status === 0 || request.status === 200) {
            return request.responseText;
        } else {
            // Failed synchronous loading
            return '';
        }
    }

    static requestFromServer (url, whenDone) {
      
        iOS.waitForInterface(function() {
        	iOS.gettextresource(url, whenDone);
        });
        
    }

    static getThumbnail (str, w, h, destw, desth) {
        str = str.replace(/>\s*</g, '><');
        var xmlDoc = new DOMParser().parseFromString(str, 'text/xml');
        var extxml = document.importNode(xmlDoc.documentElement, true);
        if (extxml.childNodes[0].nodeName == '#comment') {
            extxml.removeChild(extxml.childNodes[0]);
        }
        var srccnv = document.createElement('canvas');
        setCanvasSize(srccnv, w, h);
        var ctx = srccnv.getContext('2d');
        for (var i = 0; i < extxml.childElementCount; i++) {
            SVG2Canvas.drawLayer(extxml.childNodes[i], ctx);
        }
        if (!destw || !desth) {
            return srccnv.toDataURL('image/png');
        }
        var cnv = document.createElement('canvas');
        setCanvasSize(cnv, destw, desth);
        drawThumbnail(srccnv, cnv);
        return cnv.toDataURL('image/png');
    }

    // in iOS casting an svg url in a img.src works except when the SVG has images.
    // This code avoids that bug
    // also when in debug mode you need to get the base64 to avoid sandboxing issues
    static getAsset (md5, fcn) { // returns either a link or a base64 dataurl
        if (MediaLib.keys[md5]) {
            fcn(MediaLib.path + md5); return;
        } // just url link assets do not have photos
        if (md5.indexOf('/') > -1) {
            IO.requestFromServer(md5, gotit); // get url contents
            return;
        }
        if ((IO.getExtension(md5) == 'png') && iOS.path) {
            fcn(iOS.path + md5); // only if it is not in debug mode
        } else {
            iOS.getmedia(md5, nextStep);
        } // get url contents

        function gotit (str) {
            var base64 = IO.getImageDataURL(md5, btoa(str));
            if (str.indexOf('xlink:href') < 0) {
                fcn(md5); // does not have embedded images
            } else {
                IO.getImagesInSVG(str, function () {
                    fcn(base64);
                });
            } // base64 dataurl
        }

        function nextStep (dataurl) { // iOS 7 requires to read the internal base64 images before returning contents
            var str = atob(dataurl);
            if ((str.indexOf('xlink:href') < 0) && iOS.path) {
                fcn(iOS.path + md5); // does not have embedded images
            } else {
                var base64 = IO.getImageDataURL(md5, dataurl);
                IO.getImagesInSVG(str, function () {
                    fcn(base64);
                }); // base64 dataurl
            }
        }
    }

    static getImagesInSVG (str, whenDone) {
        str = str.replace(/>\s*</g, '><');
        if (str.indexOf('xlink:href') < 0) {
            whenDone(); // needs this in case of reading a PNG in debug mode
        } else {
            loadInnerImages(str, whenDone);
        }

        function loadInnerImages (str, whenDone) {
            var xmlDoc = new DOMParser().parseFromString(str, 'text/xml');
            var extxml = document.importNode(xmlDoc.documentElement, true);
            if (extxml.childNodes[0].nodeName == '#comment') {
                extxml.removeChild(extxml.childNodes[0]);
            }
            var images = IO.getImages(extxml, []);
            var imageCount = images.length;
            // An xlink:href on something other than an <image> leaves nothing to
            // wait for, and an image that fails to load never fires onload; both
            // used to leave whenDone uncalled for good.
            if (imageCount < 1) {
                whenDone();
                return;
            }
            for (var i = 0; i < images.length; i++) {
                var dataurl = images[i].getAttribute('xlink:href');
                var svgimg = document.createElement('img');
                svgimg.src = dataurl;
                if (!svgimg.complete) {
                    svgimg.onload = function () {
                        readToLad();
                    };
                    svgimg.onerror = svgimg.onload;
                } else {
                    readToLad();
                }
            }

            function readToLad () {
                imageCount--;
                if (imageCount < 1) {
                    extxml = null;
                    xmlDoc = null;
                    whenDone();
                }
            }
        }
    }

    static getImages (p, res) {
        for (var i = 0; i < p.childNodes.length; i++) {
            var elem = p.childNodes[i];
            if (elem.nodeName == 'metadata') {
                continue;
            }
            if (elem.nodeName == 'defs') {
                continue;
            }
            if (elem.nodeName == 'sodipodi:namedview') {
                continue;
            }
            if (elem.nodeName == '#comment') {
                continue;
            }
            if (elem.nodeName == 'image') {
                res.push(elem);
            }
            if (elem.nodeName == 'g') {
                IO.getImages(elem, res);
            }
        }
        return res;
    }
    static getImageDataURL (md5, data) {
        var header = '';
        switch (IO.getExtension(md5)) {
        case 'svg': header = 'data:image/svg+xml;base64,';
            break;
        case 'png': header = 'data:image/png;base64,';
            break;
        }
        return header + data;
    }

    static getObject (md5, fcn) {
        if (md5.indexOf('/') > -1) {
            var gotit = function (str) {
                fcn(str);
            };
            IO.requestFromServer(md5, gotit);
        } else {
            IO.getObjectinDB(database, md5, fcn);
        }
    }

    static getObjectinDB (db, md5, fcn) {
        var json = {};
        json.stmt = 'select * from ' + db + ' where id = ?';
        json.values = [md5];
        iOS.query(json, fcn);
    }

    static setMedia (data, type, fcn) {
        iOS.setmedia(btoa(data), type, fcn);
    }

    static query (type, obj, fcn) {
        var json = {};
        json.stmt = 'select ' + obj.items + ' from ' + type +
            ' where ' + obj.cond + (obj.order ? ' order by ' + obj.order : '');
        json.values = obj.values;
        iOS.query(json, fcn);
    }

    static deleteobject (type, id, fcn) {
        var json = {};
        json.stmt = 'delete from ' + type + ' where id = ?';
        json.values = [id];
        iOS.stmt(json, fcn);
    }

    ////////////////////////
    // projects
    ///////////////////////
    /*
        +[id] =>  // SQL ID creates this
        [deleted] =>
        [name] =>
        [json] => project data
        [thumb] =>
        [mtime] => modification time
    */

    static createProject (obj, fcn) {
        var json = {};
        var keylist = ['name', 'version', 'deleted', 'mtime', 'isgift'];
        var values = '?,?,?,?,?';
        var mtime = (new Date()).getTime().toString();
        var isGift = obj.isgift ? obj.isgift : '0';
        json.values = [obj.name, obj.version, 'NO', mtime, isGift];
        if (obj.json) {
            addValue('json', JSON.stringify(obj.json));
        }
        if (obj.thumbnail) {
            addValue('thumbnail', JSON.stringify(obj.thumbnail));
        }
        json.stmt = 'insert into ' + database + ' (' + keylist.toString() + ') values (' + values + ')';
        iOS.stmt(json, fcn);
        function addValue (key, str) {
            keylist.push(key);
            values += ',?';
            json.values.push(str);
        }
    }

    static saveProject (obj, fcn) {
        var json = {};
        var keylist = ['version = ?', 'deleted = ?', 'name = ?', 'json = ?', 'thumbnail = ?', 'mtime = ?'];
        json.values = [obj.version, obj.deleted, obj.name, JSON.stringify(obj.json),
            JSON.stringify(obj.thumbnail), (new Date()).getTime().toString()];
        json.stmt = 'update ' + database + ' set ' + keylist.toString() + ' where id = ' + obj.id;
        iOS.stmt(json, fcn);
    }

    // Since saveProject is changing the modified time of the project,
    // let's just simply update the isgift flag in a separate function...
    static setProjectIsGift (obj, fcn) {
        var json = {};
        var keylist = ['isgift = ?'];
        json.values = [obj.isgift];
        json.stmt = 'update ' + database + ' set ' + keylist.toString() + ' where id = ' + obj.id;
        iOS.stmt(json, fcn);
    }

    static getExtension (str) {
        return str.substring(str.indexOf('.') + 1, str.length);
    }

    static getFilename (str) {
        return str.substring(0, str.indexOf('.'));
    }

    static parseProjectData (data) {
        var res = {};
        for (var key in data) {
            res[key.toLowerCase()] = data[key];
        }
        return res;
    }

    //////////////////
    // Sharing
    ////////////////////

    static zipProject (projectReference, finished) {
        IO.getObject(projectReference, function (projectFromDB) {
            var projectMetadata = {
                'thumbnails': [],
                'characters': [],
                'backgrounds': [],
                'sounds': []
            };
            var jsonData = IO.parseProjectData(JSON.parse(projectFromDB)[0]);

            // Collect project assets for inclusion in zip file
            // Parse JSON representations of project data / thumbnail into usable types
            if (typeof jsonData.json == 'string') {
                jsonData.json = JSON.parse(jsonData.json);
            }
            if (typeof jsonData.thumbnail == 'string') {
                jsonData.thumbnail = JSON.parse(jsonData.thumbnail);
            }

            // No row, or a row the editor has never saved into (the lobby's +
            // button creates one with only a name), has nothing to pack.
            if (!jsonData.json || !jsonData.json.pages) {
                throw new Error('Project ' + projectReference + ' has no saved pages in the database' +
                    (jsonData.name ? '' : ' (no project row found)'));
            }

            // Method to determine if a particular asset needs to be collected
            // If it does, save the reference in projectMetadata for collection
            var collectAsset = function (assetType, md5) {
                if (md5 && (typeof md5 !== 'undefined')) {
                    if (md5.indexOf('samples/') < 0) { // Exclude sample assets
                        if (collectLibraryAssets) {
                            // Behavior if we want to collect and package library assets
                            if (projectMetadata[assetType].indexOf(md5) < 0 && MediaLib.sounds.indexOf(md5) < 0) {
                                projectMetadata[assetType].push(md5);
                            }
                        } else {
                            // Otherwise, first check if it's in the library
                            if (md5 && (typeof md5 !== 'undefined') &&
                                !MediaLib.keys[md5] && MediaLib.sounds.indexOf(md5) < 0) {
                                if (projectMetadata[assetType].indexOf(md5) < 0) {
                                    projectMetadata[assetType].push(md5);
                                }
                            }
                        }
                    }
                }
            };

            // Project thumbnail. A project written straight into the database,
            // as the MCP server does, has none until the editor next saves it.
            if (jsonData.thumbnail) {
                collectAsset('thumbnails', jsonData.thumbnail.md5);
            }

            var projectData = jsonData.json;

            // Data for each page
            for (var p = 0; p < projectData.pages.length; p++) {
                var pageReference = projectData.pages[p];
                var page = projectData[pageReference];

                // Page background
                collectAsset('backgrounds', page.md5);

                // Sprites
                for (var s = 0; s < page.sprites.length; s++) {
                    var spriteReference = page.sprites[s];
                    var sprite = page[spriteReference];

                    if (sprite.type != 'sprite') {
                        continue;
                    }

                    // Sprite image
                    collectAsset('characters', sprite.md5);

                    // Sprite's recorded sounds
                    for (var snd = 0; snd < sprite.sounds.length; snd++) {
                        collectAsset('sounds', sprite.sounds[snd]);
                    }
                }
            }

            // Get the media in projectMetadata and add it to a zip file
            zipFile = new JSZip();
            zipFile.folder('project');

            var projectDataForZip = JSON.stringify(jsonData);
            zipFile.file('project/data.json', projectDataForZip, {});

            zipAssetsExpected = 0;
            zipAssetsActual = 0;

            // Generic function for adding media to the zip file
            var addMediaToZip = function (folder, md5) {
                var addB64ToZip = function (b64data) {
                    zipFile.file('project/' + folder + '/' + md5, b64data, {
                        base64: true,
                        createFolders: true
                    });
                    zipAssetsActual++;
                };
                // Determine if the md5 is a MediaLib file or a user one, and download it appropriately
                // See also, Sprite.getAsset
                if (md5 in MediaLib.keys) {
                    // Library character
                    IO.requestFromServer(MediaLib.path + md5, function (raw) {
                        addB64ToZip(btoa(raw));
                    });
                } else {
                    // User file
                    iOS.getmedia(md5, addB64ToZip);
                }
            };

            // Add each type of media
            for (var j = 0; j < projectMetadata.thumbnails.length; j++) {
                addMediaToZip('thumbnails', projectMetadata.thumbnails[j]);
                zipAssetsExpected++;
            }

            for (var k = 0; k < projectMetadata.characters.length; k++) {
                addMediaToZip('characters', projectMetadata.characters[k]);
                zipAssetsExpected++;
            }

            for (var l = 0; l < projectMetadata.backgrounds.length; l++) {
                addMediaToZip('backgrounds', projectMetadata.backgrounds[l]);
                zipAssetsExpected++;
            }

            for (var m = 0; m < projectMetadata.sounds.length; m++) {
                addMediaToZip('sounds', projectMetadata.sounds[m]);
                zipAssetsExpected++;
            }

            // Now the UI should wait for actual media count to equal expected media count
            // This could pause if getmedia takes a long time, for example,
            // if we have many large sprites or large sounds

            // strip spaces and sanitize filename, including windows reserved names even though
            // kids are unlikely to name their project lpt1 etc.
            var illegalRe = /[\/\?<>\\:\*\|":]/g;
            var controlRe = /[\x00-\x1f\x80-\x9f]/g;  // eslint-disable-line no-control-regex
            var reservedRe = /^\.+$/;
            var windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
            var windowsTrailingRe = /[\. ]+$/;

            zipFileName = jsonData.name.replace(/\s*/g, '');
            zipFileName = zipFileName
                .replace(illegalRe, '_')
                .replace(controlRe, '_')
                .replace(reservedRe, '_')
                .replace(windowsReservedRe, '_')
                .replace(windowsTrailingRe, '_');
            shareName = jsonData.name;

            // JSZip 3 only generates asynchronously; the 2.x generate() this was
            // written against no longer exists. Comparing counts rather than
            // dividing them also copes with a project that has no assets at all.
            function checkStatus () {
                if (zipAssetsActual == zipAssetsExpected) {
                    zipFile.generateAsync({
                        'type': 'base64',
                        'compression': 'STORE'
                    }).then(finished);
                } else {
                    setTimeout(checkStatus, 200);
                }
            }
            checkStatus();
        });
    }

    static uniqueProjectName (jsonData, callback, useOne) {
        // Ensure the project name is not a duplicate

        // Split project name from trailing number
        // Returns [project name, number]
        // E.g., "Project 2" -> ["Project", 2]
        // "My project" -> ["My project", null];
        var nameAndNumber = function (name) {
            var splitName = name.split(' ');
            var lastPart = splitName.pop();
            if (!isNaN(lastPart)) {
                return {
                    'name': splitName.join(' '),
                    'number': parseInt(lastPart)
                };
            } else {
                return {
                    'name': name,
                    'number': null
                };
            }
        };

        var giftProjectNameParts = nameAndNumber(jsonData.name);

        // Get project names already existing in the DB
        var json = {};
        json.cond = 'deleted = ? AND gallery IS NULL';
        json.items = ['name'];
        json.values = ['NO'];
        IO.query(iOS.database, json, function (existingProjects) {
            var newNumber = null;

            existingProjects = JSON.parse(existingProjects);
            for (var i = 0; i < existingProjects.length; i++) {
                var existingProjectName = IO.parseProjectData(existingProjects[i]).name;
                var existingProjectNameParts = nameAndNumber(existingProjectName);
                if (giftProjectNameParts.name == existingProjectNameParts.name) {
                    if (existingProjectNameParts.number != null) {
                        // "My project 2" -> "My project 3"
                        newNumber = existingProjectNameParts.number + 1;
                    } else {
                        // "My project" -> "My project 2"
                        newNumber = 2;
                    }
                }

            }

            if (newNumber != null && (!giftProjectNameParts.number || newNumber > giftProjectNameParts.number)) {
                // A duplicate project name exists - update it
                jsonData.name = giftProjectNameParts.name + ' ' + newNumber;
            } else if (useOne) {
                jsonData.name = giftProjectNameParts.name + ' 1';
            }
            callback(jsonData);
        });
    }

    // Receive a base64-encoded zip from iOS (upon open a project)
    //
    // Returns a promise that settles once the project and every asset in the file
    // are in the database, so the caller knows when it is safe to leave the page.
    // JSZip 3 only reads archives asynchronously; the 2.x load(), asText() and
    // asBinary() this was first written against no longer exist.
    static loadProjectFromSjr (b64data) {
        // To store character MD5 -> character name map
        // The character name is stored in the project JSON; when we load
        // the actual SVG asset, we need the associated name for storage in the DB
        var characterNames = {};

        return JSZip.loadAsync(b64data, {
            'base64': true
        }).then(function (receivedZip) {
            var files = [];
            receivedZip.forEach(function (relativePath, file) {
                if (!file.dir) {
                    files.push(file);
                }
            });

            // First find the data.json project file
            var projectFile = files.filter(function (file) {
                return file.name.split('/').pop() == 'data.json';
            })[0];
            if (!projectFile) {
                throw new Error('There is no ScratchJr project inside this file.');
            }

            return projectFile.async('string').then(function (text) {
                var jsonData = JSON.parse(text);

                // To require an upgrade, change the major version numbers in .html files and here...
                var currentVersion = 1;
                var projectVersion = parseInt(jsonData.version.replace('iOSv', '')) || 0;

                if (projectVersion > currentVersion) {
                    throw new Error('Project created in a new version of ScratchJr. Please upgrade ScratchJr.');
                }

                // Build map of character filename -> character name
                var projectData = jsonData.json;
                for (var p = 0; p < projectData.pages.length; p++) {
                    var pageReference = projectData.pages[p];
                    var page = projectData[pageReference];
                    for (var s = 0; s < page.sprites.length; s++) {
                        var spriteReference = page.sprites[s];
                        var sprite = page[spriteReference];
                        // Store a database-friendly sprite name
                        if (sprite.type == 'sprite') {
                            characterNames[sprite.md5] = (
                                ((unescape(sprite.name)).replace(/[0-9]/g, '')).replace(/\s*/g, '')
                            );
                        }
                    }
                }

                return new Promise(function (resolve) {
                    IO.uniqueProjectName(jsonData, function (jsonData) {
                        jsonData.isgift = '1'; // Project will display with a bow and ribbon
                        IO.createProject(jsonData, resolve);
                    });
                });
            }).then(function () {
                // One asset at a time: characters and backgrounds are each drawn
                // onto a canvas for their thumbnails.
                return files.reduce(function (previous, file) {
                    return previous.then(function () {
                        return IO.saveSjrAsset(file, characterNames);
                    });
                }, Promise.resolve());
            });
        }).then(function () {
            // For updating the Lobby UI - if we're on the lobby page when receiving a project, refresh it
            if (gn('hometab') !== null) { // Check if we're on the lobby page
                Lobby.setPage('home');
            }
        });
    }

    // Stores one file from an .sjr archive; the promise resolves once it is saved.
    static saveSjrAsset (file, characterNames) {
        var relativePath = file.name;
        var subFolder = relativePath.split('/')[1]; // should be {backgrounds, characters, thumbnails, sounds}

        // Filename processing
        var fullName = relativePath.split('/').pop(); // e.g. Cat.svg
        var name = fullName.split('.')[0]; // e.g. Cat
        var ext = fullName.split('.').pop(); // e.g. svg

        if (!name || !ext) {
            return Promise.resolve();
        }

        // Don't save items we already have in the MediaLib
        if (fullName in MediaLib.keys) {
            return Promise.resolve();
        }

        if (subFolder == 'thumbnails' || subFolder == 'sounds') {
            // Save these immediately to the filesystem - no additional processing necessary
            return file.async('base64').then(function (b2data) {
                return new Promise(function (resolve) {
                    iOS.setmedianame(b2data, name, ext, resolve);
                });
            });
        }

        if (subFolder != 'characters' && subFolder != 'backgrounds') {
            return Promise.resolve(); // Ignore this file - someone messed with the SJR...
        }

        // File data and base64-encoded data
        return Promise.all([file.async('string'), file.async('base64')]).then(function (contents) {
            var data = contents[0];
            var b2data = contents[1];

            return new Promise(function (resolve) {
                if (subFolder == 'characters') {
                    // This code is messy - needs a refactor sometime for all the database calls/duplication for bkgs...

                    // Save the character, generate its thumbnail, and add entry to the database
                    iOS.setmedianame(b2data, name, ext, function () { // Saves the SVG
                        // Parse SVG to determine width/height
                        var svgParser = new DOMParser().parseFromString(data, 'text/xml');
                        var width = svgParser.getElementsByTagName('svg')[0].width.baseVal.value;
                        var height = svgParser.getElementsByTagName('svg')[0].height.baseVal.value;
                        var scale = '0.5'; // fixed value - see PaintIO

                        IO.getImagesInSVG(data, gotSVGImages);

                        function gotSVGImages () {
                            var thumbnailDataURL = IO.getThumbnail(data, width, height, 120, 90);

                            var thumbnailPngBase64 = thumbnailDataURL.split(',')[1];

                            var charName = characterNames[fullName];

                            iOS.setmedia(thumbnailPngBase64, 'png', function (thumbnailMD5) {
                                // Sprite thumbnail is saved - save character to the DB

                                // First ensure that this character doesn't already exist in the exact form
                                var json = {};
                                json.cond = ('ext = ? AND md5 = ? AND altmd5 = ? AND name = ? ' +
                                    'AND scale = ? AND width = ? AND height = ?');
                                json.items = ['*'];
                                json.values = ['svg', fullName, thumbnailMD5,
                                    charName, scale, width.toString(), height.toString()];
                                json.order = 'ctime desc';
                                IO.query('usershapes', json, function (results) {
                                    results = JSON.parse(results);
                                    if (results.length == 0) {
                                        // This character doesn't already exist - insert it
                                        var json = {};
                                        var keylist = ['scale', 'md5', 'altmd5',
                                            'version', 'width', 'height', 'ext', 'name'];
                                        var values = '?,?,?,?,?,?,?,?';
                                        json.values = [scale, fullName, thumbnailMD5, 'iOSv01',
                                            width.toString(), height.toString(), 'svg', charName];
                                        json.stmt = 'insert into usershapes ('
                                            + keylist.toString() + ') values (' + values + ')';

                                        iOS.stmt(json, resolve);
                                    } else {
                                        resolve();
                                    }
                                });
                            });
                        }
                    });
                } else {
                    // Same idea as characters, but the dimensions are fixed
                    iOS.setmedianame(b2data, name, ext, function () {
                        IO.getImagesInSVG(data, gotSVGImages);

                        function gotSVGImages () {
                            var thumbnailDataURL = IO.getThumbnail(data, 480, 360, 120, 90);
                            var thumbnailPngBase64 = thumbnailDataURL.split(',')[1];
                            iOS.setmedia(thumbnailPngBase64, 'png', function (thumbnailMD5) {

                                // First ensure that this bg doesn't already exist in the exact form
                                var json = {};
                                json.cond = 'ext = ? AND md5 = ? AND altmd5 = ?';
                                json.items = ['*'];
                                json.values = ['svg', fullName, thumbnailMD5];
                                json.order = 'ctime desc';
                                IO.query('userbkgs', json, function (results) {
                                    results = JSON.parse(results);
                                    if (results.length == 0) {
                                        // Background is unique, insert into the library
                                        var json = {};
                                        var keylist = ['md5', 'altmd5', 'version', 'width', 'height', 'ext'];
                                        var values = '?,?,?,?,?,?';
                                        json.values = [fullName, thumbnailMD5, 'iOSv01', '480', '360', 'svg'];
                                        json.stmt = 'insert into userbkgs (' + keylist.toString() +
                                            ') values (' + values + ')';
                                        iOS.stmt(json, resolve);
                                    } else {
                                        resolve();
                                    }
                                });
                            });
                        }
                    });
                }
            });
        });
    }
}
