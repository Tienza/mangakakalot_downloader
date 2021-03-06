'use strict'

const fs = require('fs');
const hooman = require('hooman');

const bulkDownloader = require('./bulk_manga_downloader');
const helper = require('./helper');

const sysArgs = new Set(process.argv);


const MKK_PREFIX = 'https://ww1.mangakakalots.com';
const MKK_MANGA_LINK_PREFIX = MKK_PREFIX + '/manga/';
const MKK_MANGA_STATUS_REGEX = /\<li\>Status\s\:\s(.*?)\<\/li\>/;
const MKK_MANGA_CHAPTER_URL_REGEX = /\<div\sclass\=\"row\"\>\s+\<span\>\<a\shref\=\"(.*)\"\s+title\=\".*\>/;

const chapterLinkRegex = /\<td\>\s+\<a\shref\=\"(.*)\"\stitle\=\".*\"\>\s+.*\s+\<\/td\>/;
const statusRegex = /\<span\sclass\=\"info\"\>Status\:\<\/span\>&nbsp\;(\w+)\n+/;
const kmPrefix = 'https://kissmanga.com';
const kmLinkPrefix = kmPrefix + '/Manga/'

const setDiff = (a, b) => {
    return a.filter((currVal) => !b.has(currVal));
};

(async () => {
    console.log('Updating Tracker File && Writing New Downloads Links...');
    // If the ./urls.txt doesn't exit, then create it
    if (!fs.existsSync(helper.URLS_FILE_NAME)) {
        fs.writeFileSync(helper.URLS_FILE_NAME, '');
    }
    // If the tracked_manga.json doesn't exist, then create it
    if (!fs.existsSync(helper.TRACKED_MANGA_FILE_NAME)) {
        fs.writeFileSync(helper.TRACKED_MANGA_FILE_NAME, '{}');
    }
    // If the title_mapper.json doesn't exist, then create it
    if (!fs.existsSync(helper.TITLE_MAPPER_FILE_NAME)) {
        fs.writeFileSync(helper.TITLE_MAPPER_FILE_NAME, '{}');
    }
    // Set initial run variables
    let updatedNeeded = false;
    let completedManga = [];
    // Read in the tracked_manga JSON object to start tracking process
    let trackedManga = JSON.parse(fs.readFileSync(helper.TRACKED_MANGA_FILE_NAME).toString());
    for (let mangaName in trackedManga) {
        // Retrieve the object that stores all information for current manga
        let currManga = trackedManga[mangaName];
        // Check to see if the status of the manga is pau
        if (currManga.paused === undefined || currManga.paused === null || !currManga.paused) {
            try { // Open the manga url in a headless browser - assign to response object
                let hoomanResponse = await hooman.get(MKK_MANGA_LINK_PREFIX + currManga.urlKey);
                let response = hoomanResponse.body;
                // Retrieve the manga's current status from the response body
                let mangaStatus = response.match(MKK_MANGA_STATUS_REGEX);
                // Assign the status to a variable, if no status found then assume Ongoing
                let status = (mangaStatus.length > 1) ? mangaStatus[1].trim() : helper.STATUS_ONGOING;
                // Retrieve all chapter links from the response body
                let totalChapters = response.match(new RegExp(MKK_MANGA_CHAPTER_URL_REGEX, 'g'))
                    .map((currVal) => {
                        let chapter = currVal.match(MKK_MANGA_CHAPTER_URL_REGEX);
                        if (chapter.length > 1) return chapter[1];
                    });
                // If the number of chapters found in the obj and the response body don't match 
                if (currManga.tracked.length !== totalChapters.length) {
                    updatedNeeded = true; // Flag that the manage has been updated
                    console.log(`${mangaName}: Missing ${totalChapters.length - currManga.tracked.length} Chapter(s) | Download Limit: ${(currManga.limit !== undefined && currManga.limit !== null) ? currManga.limit : 'null'} | Status: ${status}`);
                    // From all the chapter links, filter out the ones we currently do not track
                    let missingChapterLinks = setDiff(totalChapters, new Set(currManga.tracked));
                    // Check if a limit has been set filter out the missingLinks again
                    if (currManga.limit !== undefined && missingChapterLinks.length > currManga.limit) {
                        missingChapterLinks = missingChapterLinks.slice(missingChapterLinks.length - currManga.limit);
                    }
                    // Update tracked_manga object
                    currManga.tracked = (currManga.limit === undefined || currManga.limit === null) ? totalChapters : missingChapterLinks.concat(currManga.tracked);
                    // Append all the links that need to be downloaded to urls.txt
                    fs.appendFileSync(helper.URLS_FILE_NAME,
                        missingChapterLinks.map((url) => MKK_PREFIX + url).join('\n') + '\n');
                } else { // Otherwise no updates nee to be performed
                    console.log(`${mangaName}: All Caught Up! | Status: ${status}`);
                }
                // If a manga's status has been marked as Completed then store the manga's name
                if (status === helper.STATUS_COMPLETED) completedManga.push(mangaName);
            } catch (error) {
                console.log(error.response.body);
            }
        } else {
            console.log(`${mangaName}: Paused | Skipping...`);
        }
    }
    // If there are manga that are currently being tracked that have been marked as Completed
    if (completedManga.length > 0) {
        // For every manga that has been marked as Completed remove from the tracked_manga object
        for (let mangaName of completedManga) {
            console.log(`${mangaName} is marked as ${helper.STATUS_COMPLETED}. Removing from ${helper.TRACKED_MANGA_FILE_NAME}`);
            delete trackedManga[mangaName];
        };
    }
    // Persist the new tracked_manga object for the next run
    fs.writeFileSync(helper.TRACKED_MANGA_FILE_NAME, JSON.stringify(trackedManga));
    console.log('Tracking File Updated');
    // Update the title_mapper
    console.log(`Building ${helper.TITLE_MAPPER_FILE_NAME}`);
    let titleMapper = {};
    for (let mangaName in trackedManga) {
        titleMapper[trackedManga[mangaName].urlKey] = mangaName;
    }
    // Persist to title_mapper.json file for next steps
    fs.writeFileSync(helper.TITLE_MAPPER_FILE_NAME, JSON.stringify(titleMapper));
    console.log('Title Mapper Updated');
    // Determine what the necessary next steps are...
    if (updatedNeeded && !sysArgs.has('-u')) { // Normal run, initiate the bulk_download process
        await bulkDownloader.initBulkDownload();
    } else if (sysArgs.has('-u')) { // User just wanted to update the tracked_manga file. Truncate urls.txt
        fs.writeFileSync(helper.URLS_FILE_NAME, '');
        console.log(`-u Update-Only Request Completed. Truncating ${helper.URLS_FILE_NAME}. manga_tracker exiting...`);
    } else { // No updates where needed, and user is all caught up with tracked_manga
        console.log('You\'re all caught up with your tracked manga, Congratulations!');
        console.log('No action required... manga_tracker exiting...');
    }
})();
