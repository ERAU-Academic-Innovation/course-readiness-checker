// ==UserScript==
// @name         Course Readiness and Teacher Activity Reminders
// @namespace    https://github.com/Wilmington-University-Ed-Tech-Systems/Shared-Custom-Developments/tree/main/Canvas%20LMS/Course%20Readiness%20and%20Teacher%20Activity%20Reminders
// @version      7.7.5
// @date         10/12/2026
// @description  Adds reminders on the course home page for things a teacher needs to do to meet course readiness
// @author       James Sekcienski, Ed Tech Systems, Wilmington University
// @contributors Kolton Galie, ERAU
// @match      https://*.instructure.com/courses/*
// ==/UserScript==

"use strict";



(async () => {
    const SCRIPT_LOAD_KEY = "__courseReadinessCheckerLoadedTest";
    if (window[SCRIPT_LOAD_KEY]) {
        console.warn("[CR/TA] Duplicate script load skipped.");
        return;
    }
    window[SCRIPT_LOAD_KEY] = true;

    const cache = new Map();

    const STOP_AFTER_PUBLISHED = true; // Set to false to allow checks even after the course is published - KOLTON EDIT


    //CrossCourseLink allowed course IDs - KOLTON EDIT
    const ALLOWED_LINKED_COURSE_IDS = new Set(["12227","39211", "54595", "176606", "42453", "109661", "178782", "186642", "170630", "130230", "130231", "130232", "148928", "174740", "172589", "194684",]);
    const ALLOWED_PARENT_ACCOUNT_IDS = new Set(["63", "64", "65"]);
    const SETUP_INSTRUCTIONS_URL = "https://erau.instructure.com/courses/39211/pages/preterm-setup-instructions";
    const SETUP_INSTRUCTIONS_LABEL = "Setup Instructions";
    const SHOW_PILOT_FEEDBACK_BOX = true;
    const PILOT_FEEDBACK_URL = "mailto:eccdl@erau.edu;wwctlew@erau.edu?subject=Preterm%20Setup%20Checker%20Pilot%20Feedback";
    const PILOT_FEEDBACK_LABEL = "eccdl@erau.edu";
    const AlertType = Object.freeze({
        WARNING: "WARNING",
        ERROR: "ERROR",
        INFORMATIONAL: "INFO",
    });

    const RequirementType = Object.freeze({
        MANDATORY: AlertType.ERROR, // Mandatory requirements will show as an error alert when it isn't met
        WARNING: AlertType.WARNING, // Optional requirements will show as a warning alert when it isn't met
        INFORMATIONAL: AlertType.INFORMATIONAL, // This is used for informational alerts that should only appear at certain times
    });

    // Expectation Configs
    const HEADING_FOR_CHECKLIST = "Course Status";
    const ALL_SETUP_ITEMS_READY_MESSAGE = "All Preterm setup items are ready for review. Please check your ERAU email for RCTLE communications regarding preterm setup.<br><br>If you have already received communications please disregard this message.";

    class Expectation {
        static NA = "N/A"; // Use this for settings that don't apply and/or aren't set yet
        static COURSE_START = "course_start"; // Use as a special end at value
        static COURSE_END = "course_end"; // Use as a special start at value

        constructor({
            requirementType = RequirementType.INFORMATIONAL,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            this.type = requirementType; // The RequirementType for this expectation.
            this.startAt = startAt; // Days from course start date to begin checking for requirement. Use negative values for before course start date. Use NA to assume start checking now. Use COURSE_END to start from course end date.
            this.endAt = endAt; // Days from course end date to stop checking for requirement. Use negative values for before course end date. Use NA to assume it should not stop checking. Use COURSE_START to stop at course start date.

            // Default values before expectation is checked
            this.isMet = Expectation.NA;
            this.shortMessage = Expectation.NA;
            this.longMessage = Expectation.NA;
            this.messageType = requirementType;
        }

        getName() {
            return "Generic Expectation";
        }

        // Determines if this expectation should be checked based on the startAt and endAt settings and the course dates
        isActiveExpectation(courseStartDate, courseEndDate) {
            const currentDate = new Date();

            // TODO: Improve handling of special values for startAt and endAt values

            if (this.startAt == Expectation.COURSE_END && courseEndDate) {
                if (currentDate < courseEndDate) {
                    return false;
                }
            } else if (
                this.startAt != Expectation.NA &&
                this.startAt != Expectation.COURSE_END &&
                courseStartDate
            ) {
                if (this.startAt >= convertMsToDays(currentDate - courseStartDate)) {
                    return false;
                }
            }

            if (this.endAt == Expectation.COURSE_START && courseStartDate) {
                if (currentDate >= courseStartDate) {
                    return false;
                }
            } else if (
                this.endAt != Expectation.NA &&
                this.endAt != Expectation.COURSE_START &&
                courseEndDate
            ) {
                if (this.endAt < convertMsToDays(currentDate - courseEndDate)) {
                    return false;
                }
            }

            return true;
        }

        async checkExpectation(courseId) {
            this.isMet = false;
            this.shortMessage = "Undefined Expectation";
            this.longMessage =
                "This expectation is not defined so no check can be performed.";
            this.messageType = AlertType.ERROR;
        }

        static convertHTMLToText(htmlContent) {
            const tempDomParser = new DOMParser();
            const parsedHTML = tempDomParser.parseFromString(
                htmlContent,
                "text/html"
            );
            return parsedHTML?.body?.innerText ?? "";
        }

        static checkWordCountRequirement(
        minimumWordCount,
         content,
         isContentHTML = true
        ) {
            if (minimumWordCount == Expectation.NA || minimumWordCount <= 0) {
                return {
                    isMet: true,
                    details: "Not required",
                };
            }

            if (isContentHTML) {
                content = Expectation.convertHTMLToText(content);
            }

            content = content.replaceAll("\n", " "); // replace line breaks with space
            content = content.replaceAll("-", ""); // remove hyphens
            content = content.replaceAll("  ", " "); // replace duplicate spaces
            content = content.trim();

            const words = content.split(" "); // TODO: Determine if additional data cleaning may be needed
            if (words.length >= minimumWordCount) {
                return {
                    isMet: true,
                    details: "Met minimum word count requirement",
                };
            } else {
                return {
                    isMet: false,
                    details: `The minimum word count requirement (${minimumWordCount} words) has not been met. Current word count is ${words.length}.`,
                };
            }
        }

        static checkRequiredKeywords(
        requiredKeywords,
         content,
         isContentHTML = true
        ) {
            if (requiredKeywords == Expectation.NA || requiredKeywords.length == 0) {
                return {
                    isMet: true,
                    details: "Not required",
                };
            }

            if (isContentHTML) {
                content = Expectation.convertHTMLToText(content);
            }

            const formattedContent = content.toLowerCase();
            for (const keyword of requiredKeywords) {
                if (!formattedContent.includes(keyword.toLowerCase())) {
                    return {
                        isMet: false,
                        details: `The following required keyword/phrase was not found: '${keyword}'`,
                    };
                }
            }

            return {
                isMet: true,
                details: "All required keywords/phrases found",
            };
        }
    }

    class SyllabusExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            minimumWordCount = Expectation.NA,
            requiredKeywords = [],
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.minimumWordCount = minimumWordCount; // Minimum number of words on the Syllabus page. Use NA to not check something is set for the Syllabus.
            this.requiredKeywords = requiredKeywords; // A set of keywords/phrases that need to be in the Syllabus. Check is case insensitive. Leave empty if there aren't any required keywords/phrases to check for
        }

        getName() {
            return "Syllabus";
        }

        async checkExpectation(courseId) {

            // KOLTON EDIT Simple Syllabus external tool present?
            const ssTab = await findSimpleSyllabusTab(courseId);
            if (ssTab && !ssTab.hidden) {
                // (Optional) check the simple syllabus HTML loads
                let launchOk = true;
                if (ssTab?.html_url) {
                    launchOk = await tabHtmlReachable(ssTab.html_url);
                }

                if (launchOk) {
                    this.isMet = true;
                    this.shortMessage = "Syllabus provided via Simple Syllabus";
                    this.longMessage = `
      <div>
        <p>This course uses <strong>Simple Syllabus</strong> as the syllabus provider.</p>
        <p>The external tool is enabled in Course Navigation and appears reachable. (Content cannot be scanned via Canvas API.)</p>
        <p><a target="_blank" href="${ssTab.html_url || `/courses/${courseId}/settings#tab-navigation`}">Open Syllabus</a></p>
      </div>
    `;
                    return; // Skip native word-count/keyword checks
                } else {
                    // Tool is present but looks unreachable → show actionable error
                    this.isMet = false;
                    this.shortMessage = "Simple Syllabus not loading";
                    this.longMessage = `
      <div>
        <p><strong>Simple Syllabus</strong> appears in Course Navigation but the launch shell didn’t load.</p>
        <ul>
          <li>Verify the tool is installed and enabled at the account/sub-account level.</li>
          <li>Check that it is enabled (not hidden) in <a href="/courses/${courseId}/settings#tab-navigation">Navigation</a>.</li>
          <li>Confirm instructor access with the vendor if needed.</li>
        </ul>
        ${ssTab?.html_url ? `<p><a target="_blank" href="${ssTab.html_url}">Try launching Simple Syllabus</a></p>` : ""}
      </div>
    `;
                    return;
                }
            }

            // Ensure tab is visible
            const tabs = await getTabs(courseId);
            const nativeSyllabusTab = tabs.find((tab) => tab.id == "syllabus");
            if (!nativeSyllabusTab || nativeSyllabusTab?.hidden) {
                this.isMet = false;
                this.shortMessage = "Syllabus is hidden";
                this.longMessage = `
          <div>
            <p>The Syllabus page is currently hidden from students. Go to course <a href='/courses/${courseId}/settings#tab-navigation'>settings</a> to enable the Syllabus under the Navigation tab.</p>
          </div>
        `;
                return;
            }

            // Ensure there is content on the Syllabus
            const courseDetails = await getCourseDetails(courseId);
            const syllabus = courseDetails?.syllabus_body ?? "";
            if (!syllabus) {
                this.isMet = false;
                this.shortMessage = "Missing syllabus";
                this.longMessage = `
          <div>
            <p>The Syllabus page currently doesn't have any content. Update the <a href='/courses/${courseId}/assignments/syllabus'>Syllabus</a> to provide necessary information about the course to students.
          </div>
        `;
                return;
            }

            const wordCountCheck = Expectation.checkWordCountRequirement(
                this.minimumWordCount,
                syllabus,
                true
            );
            if (!wordCountCheck?.isMet) {
                this.isMet = false;
                (this.shortMessage = "Syllabus word count not met"),
                    (this.longMessage = `
          <div>
            <p>The <a href='/courses/${courseId}/assignments/syllabus'>Syllabus</a> minimum word count requirement has not been met.</p>
            <p>${wordCountCheck?.details}</p>
          </div>
        `);
                return;
            }

            const requiredKeywordsCheck = Expectation.checkRequiredKeywords(
                this.requiredKeywords,
                syllabus,
                true
            );
            if (!requiredKeywordsCheck?.isMet) {
                this.isMet = false;
                this.shortMessage = "Syllabus missing required text";
                this.longMessage = `
          <div>
            <p>The <a href='/courses/${courseId}/assignments/syllabus'>Syllabus</a> is missing a required keyword/phrase.</p>
            <p>${requiredKeywordsCheck?.details}</p>
          </div>
        `;
                return;
            }

            // Passed requirement checks
            this.isMet = true;
            this.shortMessage = "Syllabus ready for review";
        }
    }

    class SyllabusFileExpectation extends SyllabusExpectation {
        // Use this class when checking for a linked Canvas file on the Syllabus page.
        // Keep in mind required keywords will only check content directly on the page not in the file
        constructor({
            requirementType = RequirementType.MANDATORY,
            partialFileLinkText = Expectation.NA,
            isTeacherRequiredToUploadToCourse = false,
            minimumWordCount = Expectation.NA,
            requiredKeywords = [],
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({
                requirementType,
                minimumWordCount,
                requiredKeywords,
                startAt,
                endAt,
            });
            this.partialFileLinkText = partialFileLinkText; // The partial file like text that is required (i.e. 'syllabus'). Check is case insensitive. Use NA if the file name doesn't matter.
            this.isTeacherRequiredToUploadToCourse =
                isTeacherRequiredToUploadToCourse; // Whether or not a teacher of the course must upload the file to the course to meet the requirement.
        }

        getName() {
            return "Syllabus with File";
        }

        async checkExpectation(courseId) {
            // If Simple Syllabus is present & reachable, skip file requirement entirely - Kolton Edit
            const ssTab = await findSimpleSyllabusTab(courseId);
            if (ssTab && !ssTab.hidden) {
                let launchOk = true;
                if (ssTab?.html_url) {
                    launchOk = await tabHtmlReachable(ssTab.html_url);
                }
                if (launchOk) {
                    this.isMet = true;
                    this.shortMessage = "Syllabus provided via Simple Syllabus (file not required) ";
                    this.longMessage = `
        <div>
          <p>This course uses <strong>Simple Syllabus</strong>; Canvas file link on native Syllabus is not required.</p>
          ${ssTab?.html_url ? `<p><a target="_blank" href="${ssTab.html_url}">Open Simple Syllabus</a></p>` : ""}
        </div>
      `;
                    return;
                }
                // If tool exists but doesn’t launch, fall through to show actionable error below.
            }
            const courseDetails = await getCourseDetails(courseId);
            const syllabus = courseDetails?.syllabus_body ?? "";
            const tempDOM = new DOMParser().parseFromString(syllabus, "text/html");

            // Get all links to a Canvas File
            let fileLinks = [
                ...tempDOM.querySelectorAll('a[data-api-returntype="File"]'),
            ];
            if (fileLinks.length == 0) {
                this.isMet = false;
                this.shortMessage = "Missing syllabus file";
                this.longMessage = `
          <div>
            <p>No Canvas file links found on <a href='/courses/${courseId}/assignments/syllabus'>Syllabus</a> page.</p>
          </div>
        `;
                return;
            }

            if (this.partialFileLinkText != Expectation.NA) {
                // Filter the links to those with the required partial link text
                fileLinks = fileLinks.filter((link) =>
                                             link.innerText
                                             .toLowerCase()
                                             .includes(this.partialFileLinkText.toLowerCase())
                                            );
                if (fileLinks.length == 0) {
                    this.isMet = false;
                    this.shortMessage = "Missing syllabus file";
                    this.longMessage = `
            <div>
              <p>No Canvas file links found on <a href='/courses/${courseId}/assignments/syllabus'>Syllabus</a> page with the required link text.</p>
              <p>File link text must include the following: ${this.partialFileLinkText}</p>
            </div>
          `;
                    return;
                }
            }

            if (this.isTeacherRequiredToUploadToCourse === true) {
                const fileIds = this.getFileIds(fileLinks);

                if (fileIds.length == 0) {
                    this.isMet = false;
                    this.shortMessage = "Syllabus file missing";
                    this.longMessage = `
            <div>
              <p>No Canvas file links with ids found on <a href='/courses/${courseId}/assignments/syllabus'>Syllabus</a> page.</p>
            </div>
          `;
                    return;
                }

                let isTeacherUploadFound = await this.hasTeacherUploadedFile(
                    courseDetails,
                    fileIds
                );

                if (!isTeacherUploadFound) {
                    this.isMet = false;
                    this.shortMessage = "Syllabus file missing";
                    this.longMessage = `
            <div>
              <p>No Canvas file found on <a href='/courses/${courseId}/assignments/syllabus'>Syllabus</a> page that was uploaded by a teacher of this course.</p>
            </div>
          `;
                    return;
                }
            }

            // File requirements passed. Check that other Syllabus requirements are met.
            await super.checkExpectation(courseId);
        }

        getFileIds(fileLinks) {
            const fileIds = [];
            for (let fileLink of fileLinks) {
                const url = fileLink.href;
                let temp = url.split("/files/");
                if (temp.length > 1) {
                    temp = temp[1];
                    temp = temp.split("/")[0];
                    temp = temp.split("?")[0];
                    fileIds.push(temp);
                }
            }
            return fileIds;
        }

        async hasTeacherUploadedFile(courseDetails, fileIds) {
            const courseId = courseDetails?.id;
            const teachers = courseDetails?.teachers ?? [];
            const courseCreationDate = new Date(courseDetails.created_at);

            for (let fileId of fileIds) {
                const fileRequest = await getFile(courseId, fileId);
                const fileDetails = fileRequest.results;
                const userIdOfFileCreator = fileDetails?.user?.id;

                // Checking that the file was uploaded by a user after the course was created
                if (
                    userIdOfFileCreator &&
                    new Date(fileDetails["created_at"]) > courseCreationDate
                ) {
                    // Checking if the file was uploaded by a teacher of the course
                    if (
                        teachers.some((teacher) => {
                            return teacher.id == userIdOfFileCreator;
                        })
                    ) {
                        return true;
                    }
                }
            }

            return false;
        }
    }

    class PublishedCourseExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({
                requirementType,
                startAt,
                endAt,
            });
        }

        getName() {
            return "Published Course";
        }

        async checkExpectation(courseId) {
            const courseDetails = await getCourseDetails(courseId);

            if (courseDetails?.workflow_state == "unpublished") {
                this.isMet = false;
                this.shortMessage = "Course is unpublished";
                this.longMessage = `
          <div>
            <p>This course is currently unpublished. The course needs to be published before students potentially have access.</p>
          </div>
        `;
                return;
            }

            // Passed requirements
            this.isMet = true;
            this.shortMessage = "Course is published";
        }
    }

    class CourseDatesExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            requireStartDate = true,
            requireEndDate = true,
            requireParticipationToBeCourse = false,
            maxCourseLength = Expectation.NA,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({
                requirementType,
                startAt,
                endAt,
            });
            this.requireStartDate = requireStartDate;
            this.requireEndDate = requireEndDate;
            this.requireParticipationToBeCourse = requireParticipationToBeCourse; // Use true if course participation must be set to Course. Use false if Term or Course participation dates may be used.
            this.maxCourseLength = maxCourseLength; // Number of days
        }

        getName() {
            return "Course Dates";
        }

        async checkExpectation(courseId) {
            const courseDetails = await getCourseDetails(courseId);

            if (
                this.requireParticipationToBeCourse &&
                !courseDetails?.restrict_enrollments_to_course_dates
            ) {
                this.isMet = false;
                this.shortMessage = "Incorrect course participation";
                this.longMessage = `
          <div>
            <p>The course participation is not currently set to Course.</p>
            <p>Go to the course <a href='/courses/${courseId}/settings'>settings</a> to update the course participation.</p>
          </div>
        `;
                return;
            }

            const [startDate, endDate] = await getCourseStudentParticipationDates(
                courseId
            );
            if (this.requireStartDate && !startDate) {
                this.isMet = false;
                this.shortMessage = "Missing start date";
                this.longMessage = `
          <div>
            <p>The course is missing a required course start date.</p>
            <p>Go to the course <a href='/courses/${courseId}/settings'>settings</a> to update the course start date.</p>
          </div>
        `;
                return;
            }

            if (this.requireEndDate && !endDate) {
                this.isMet = false;
                this.shortMessage = "Missing end date";
                this.longMessage = `
          <div>
            <p>The course is missing a required course end date.</p>
            <p>Go to the course <a href='/courses/${courseId}/settings'>settings</a> to update the course end date.</p>
          </div>
        `;
                return;
            }

            if (
                this.maxCourseLength != Expectation.NA &&
                this.maxCourseLength > 0 &&
                (!startDate ||
                 !endDate ||
                 this.maxCourseLength < convertMsToDays(endDate - startDate))
            ) {
                this.isMet = false;
                this.shortMessage = "Course length too long";
                this.longMessage = `
          <div>
            <p>This course has extended the maximum course length of ${this.maxCourseLength} days.</p>
            <p>Go to the course <a href='/courses/${courseId}/settings'>settings</a> to update the course dates.</p>
          </div>
        `;
                return;
            }

            // Passed checks
            this.isMet = true;
            this.shortMessage = "Course dates ready for review";
        }
    }

    class AnnouncementExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            minimumCount = 1,
            requireToBePosted = true,
            requireTeacherAsAuthor = true,
            maxDaysSinceLastPost = Expectation.NA,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({
                requirementType,
                startAt,
                endAt,
            });
            if (minimumCount == Expectation.NA || minimumCount < 1) {
                minimumCount = 1;
            }
            this.minimumCount = minimumCount; // The minimum number of announcements
            this.requireToBePosted = requireToBePosted; // If true, this won't count announcements that are scheduled, but not yet posted. If false, it will include posted and scheduled announcements.
            this.requireTeacherAsAuthor = requireTeacherAsAuthor; // If true, this won't count announcements that don't have a teacher in the course as the author. If false, it won't check the author of the announcements.
            this.maxDaysSinceLastPost = maxDaysSinceLastPost; // The maximum number of days since an announcement was posted. Use Expectation.NA if there isn't a requirement.
        }

        getName() {
            return "Announcement";
        }

        async checkExpectation(courseId) {
            let announcements = await getCourseAnnouncements(courseId);
            if (this.requireToBePosted) {
                // Filter out announcements that are still delayed
                announcements = this.removeDelayedAnnouncements(announcements);
            }

            if (this.requireTeacherAsAuthor) {
                // Filter out announcements not posted by teacher of the course
                const courseDetails = await getCourseDetails(courseId);
                const teachers = courseDetails?.teachers;
                if (teachers.length == 0) {
                    this.isMet = false;
                    this.shortMessage = "No teachers enrolled";
                    this.longMessage = `
            <div>
              <p>No teachers enrolled in course.</p>
              <p>Unable to meet expectation of an announcement posted by a teacher.</p>
            </div>
          `;
                    return;
                }

                announcements = this.removeAnnouncementsNotByTeacher(
                    announcements,
                    teachers
                );
            }

            if (announcements.length < this.minimumCount) {
                this.isMet = false;
                this.shortMessage = "Missing announcement";
                this.longMessage = `
          <div>
            <p>Didn't meet the announcement expectation.</p>
            <p>There should be at least ${this.minimumCount}${
          this.requireToBePosted ? " posted" : ""
            } <a href='/courses/${courseId}/announcements'>announcement(s)</a>${
          this.requireTeacherAsAuthor ? " with a teacher as the author" : ""
            }.</p>
          </div>
        `;
                return;
            }

            if (
                this.maxDaysSinceLastPost != Expectation.NA &&
                this.maxDaysSinceLastPost >= 1
            ) {
                // Filter announcements posted older than max days
                announcements = await this.removeOldAnnouncements(
                    courseId,
                    announcements
                );

                if (announcements.length == 0) {
                    this.isMet = false;
                    this.shortMessage = "Need new announcement";
                    this.longMessage = `
            <div>
              <p>Need to post a new <a href='/courses/${courseId}/announcements'>announcement</a>.</p>
              <p>Announcements need to be posted during the course at least once every ${this.maxDaysSinceLastPost} days to meet this expectation.</p>
            </div>
          `;
                    return;
                }
            }

            // Passed requirement checks
            this.isMet = true;
            this.shortMessage = "Announcements ready for review";
        }

        removeDelayedAnnouncements(announcements) {
            return announcements.filter((announcement) => {
                const currentDateTime = new Date();

                const postedAt = announcement?.posted_at;
                if (!postedAt) {
                    return false;
                }

                const delayedPostAt = announcement?.delayed_post_at;
                if (!delayedPostAt) {
                    return true;
                }

                const delayedPostAtDateTime = new Date(delayedPostAt);
                return delayedPostAtDateTime <= currentDateTime;
            });
        }

        removeAnnouncementsNotByTeacher(announcements, teachers) {
            return announcements.filter((announcement) => {
                const author = announcement?.author;
                if (!author) {
                    return false;
                }

                return teachers.some((teacher) => {
                    return teacher?.id == author?.id;
                });
            });
        }

        async removeOldAnnouncements(courseId, announcements) {
            // Determine days since course end date
            // This will be used to adjust oldestDateTimeAllowed so that if this check
            // continues to run after course end, it won't continue to expect new announcements
            // after the course end.
            const currentDateTime = new Date();
            const [startDate, endDate] = await getCourseStudentParticipationDates(
                courseId
            );
            let daysSinceCourseEndDate = 0;
            const hasCourseEnded = endDate && endDate <= currentDateTime;
            if (hasCourseEnded) {
                daysSinceCourseEndDate = convertMsToDays(currentDateTime - endDate);
            }

            return announcements.filter((announcement) => {
                const currentDateTime = new Date();
                const oldestDateTimeAllowed = new Date();
                oldestDateTimeAllowed.setDate(
                    oldestDateTimeAllowed.getDate() -
                    this.maxDaysSinceLastPost -
                    daysSinceCourseEndDate
                );

                const postedAt = announcement?.posted_at;
                if (!postedAt) {
                    return false;
                }

                const delayedPostAt = announcement?.delayed_post_at;
                if (!delayedPostAt) {
                    const postedAtDateTime = new Date(postedAt);
                    return postedAtDateTime >= oldestDateTimeAllowed;
                }

                const delayedPostAtDateTime = new Date(delayedPostAt);
                return (
                    delayedPostAtDateTime <= currentDateTime &&
                    delayedPostAtDateTime >= oldestDateTimeAllowed
                );
            });
        }
    }

    // Kolton Edit - combined welcome + prepublish announcement check
    class CombinedAnnouncementExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.WARNING,
            keywords = ["welcome", "greetings"],
            requireTeacherAsAuthor = false,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.keywords = (Array.isArray(keywords) ? keywords : [keywords])
                .map((k) => String(k).toLowerCase())
                .filter(Boolean);
            this.requireTeacherAsAuthor = requireTeacherAsAuthor;
        }

        getName() {
            return "Welcome / Announcement Timing";
        }

        async checkExpectation(courseId) {
            const courseDetails = await getCourseDetails(courseId);

            // Only relevant while unpublished
            if (courseDetails?.workflow_state !== "unpublished") {
                this._suppress = true;
                return;
            }

            const announcements = await getCourseAnnouncements(courseId);
            const [startDate] = await getCourseStudentParticipationDates(courseId);

            let filtered = Array.isArray(announcements) ? announcements : [];

            if (this.requireTeacherAsAuthor) {
                const teachers = courseDetails?.teachers ?? [];
                filtered = filtered.filter((a) => {
                    const authorId = a?.author?.id;
                    return !!authorId && teachers.some((t) => t?.id == authorId);
                });
            }

            const normText = (html) =>
            Expectation.convertHTMLToText(html ?? "").toLowerCase();

            const isWelcomeStyle = (a) => {
                const title = (a?.title ?? "").toLowerCase();
                const messageText = normText(a?.message);
                return this.keywords.some(
                    (k) => title.includes(k) || messageText.includes(k)
                );
            };

            const effectiveDate = (a) => {
                const d = a?.delayed_post_at ?? a?.posted_at ?? null;
                return d ? new Date(d) : null;
            };

            const welcomeCandidates = filtered.filter(isWelcomeStyle);
            const welcomeScheduled = welcomeCandidates.filter((a) => !!a?.delayed_post_at);

            const welcomeScheduledOnOrAfterStart =
                  startDate instanceof Date
            ? welcomeScheduled.filter((a) => new Date(a.delayed_post_at) >= startDate)
            : welcomeScheduled;

            const otherAnnouncementsBeforeStart =
                  startDate instanceof Date
            ? filtered.filter((a) => {
                if (welcomeCandidates.some((w) => w?.id == a?.id)) return false;
                const eff = effectiveDate(a);
                return eff instanceof Date && eff < startDate;
            })
            : [];

            const welcomeBeforeStart =
                  startDate instanceof Date
            ? welcomeScheduled.filter((a) => new Date(a.delayed_post_at) < startDate)
            : [];

            // 1) No welcome found
            if (welcomeCandidates.length === 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = "No welcome-style announcement found";
                this.longMessage = `
                <div>
                    <p>No welcome-style announcement was found.</p>
                    <p>Please create a welcome announcement and set <strong>Available From</strong> to the course start date.</p>
                    ${
                        otherAnnouncementsBeforeStart.length > 0
                    ? `
                                <p><strong>Also:</strong> some announcements are posted or scheduled before the course start date.</p>
                                ${this.renderTimingDetails(courseId, otherAnnouncementsBeforeStart, effectiveDate)}
                            `
                            : ""
            }
                </div>
            `;
                return;
            }

            // 2) Welcome found, but not scheduled
            if (welcomeScheduled.length === 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = "Welcome announcement found but not scheduled";
                this.longMessage = `
                <div>
                    <p>A welcome-style announcement was found, but it is <strong>not scheduled</strong>.</p>
                    <p>Set its <strong>Available From</strong> date to the course start date.</p>

                    <details>
                        <summary>Welcome announcement(s) found (${welcomeCandidates.length})</summary>
                        <ul>
                            ${welcomeCandidates.map((a) => `
                                <li>
                                    <a target="_blank" href="/courses/${courseId}/discussion_topics/${a?.id}">
                                        ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                                    </a>
                                    ${a?.posted_at ? ` — <em>posted: ${new Date(a.posted_at).toLocaleString()}</em>` : ""}
                                </li>
                            `).join("")}
                        </ul>
                    </details>

                    ${
                        otherAnnouncementsBeforeStart.length > 0
                    ? `
                                <p><strong>Also:</strong> some announcements are posted or scheduled before the course start date.</p>
                                ${this.renderTimingDetails(courseId, otherAnnouncementsBeforeStart, effectiveDate)}
                            `
                            : ""
            }
                </div>
            `;
                return;
            }

            // 3) Welcome found, but scheduled too early
            if (startDate instanceof Date && welcomeScheduledOnOrAfterStart.length === 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = "Welcome announcement found but scheduled too early";
                this.longMessage = `
                <div>
                    <p>A welcome-style announcement was found, but it is scheduled <strong>before</strong> the course start date.</p>
                    <p>Update its <strong>Available From</strong> date to be on or after the course start date.</p>

                    <details>
                        <summary>Welcome announcement(s) scheduled before start (${welcomeBeforeStart.length})</summary>
                        <ul>
                            ${welcomeBeforeStart.map((a) => `
                                <li>
                                    <a target="_blank" href="/courses/${courseId}/discussion_topics/${a?.id}">
                                        ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                                    </a>
                                    ${a?.delayed_post_at ? ` — <em>scheduled: ${new Date(a.delayed_post_at).toLocaleString()}</em>` : ""}
                                </li>
                            `).join("")}
                        </ul>
                    </details>

                    ${
                        otherAnnouncementsBeforeStart.length > 0
                    ? `
                                <p><strong>Also:</strong> some announcements are posted or scheduled before the course start date.</p>
                                ${this.renderTimingDetails(courseId, otherAnnouncementsBeforeStart, effectiveDate)}
                            `
                            : ""
            }
                </div>
            `;
                return;
            }

            // 4) Welcome is fine, but other announcements are too early
            if (otherAnnouncementsBeforeStart.length > 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = "Welcome announcement found";
                this.longMessage = `
                <div>

                    <p>Some announcements are posted or scheduled before the course start date.</p>
                    ${this.renderTimingDetails(courseId, otherAnnouncementsBeforeStart, effectiveDate)}
                </div>
            `;
                return;
            }

            // 5) Pass
            this.isMet = true;
            this.messageType = AlertType.INFORMATIONAL;
            this.shortMessage = "Welcome announcement scheduled";
        }

        renderTimingDetails(courseId, otherAnnouncementsBeforeStart, effectiveDate) {
            return `
            <details>
                <summary>Other announcements before course start (${otherAnnouncementsBeforeStart.length})</summary>
                <ul>
                    ${otherAnnouncementsBeforeStart.map((a) => `
                        <li>
                            <a target="_blank" href="/courses/${courseId}/discussion_topics/${a?.id}">
                                ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                            </a>
                            ${
                                (() => {
                const eff = effectiveDate(a);
                return eff ? ` — <em>${eff.toLocaleString()}</em>` : "";
            })()
                                                        }
                        </li>
                    `).join("")}
                </ul>
            </details>
        `;
        }
    }


    /*     //Kolton Edit - Warn if announcements were posted while unpublished
    class PrePublishAnnouncementsExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.INFORMATIONAL,
            startAt = Expectation.NA,
            endAt = Expectation.COURSE_START,
            welcomeKeywords = ["welcome", "greetings"],
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.welcomeKeywords = welcomeKeywords;
        }

        getName() {
            return "Announcements Timing (Unpublished + Term Start)";
        }

        async checkExpectation(courseId) {
            const courseDetails = await getCourseDetails(courseId);

            // Only relevant when the course is UNPUBLISHED
            if (courseDetails?.workflow_state !== "unpublished") {
                this._suppress = true;
                return;
            }

            const announcements = await getCourseAnnouncements(courseId);
            if (!Array.isArray(announcements) || announcements.length === 0) {
                this.isMet = true;
                this.shortMessage = "Announcements ready for review";
                this.messageType = AlertType.INFORMATIONAL;
                return;

            }

            const now = new Date();
            const [startDate] = await getCourseStudentParticipationDates(courseId);

            const normText = (html) => Expectation.convertHTMLToText(html ?? "").toLowerCase();

            const isWelcomeStyle = (a) => {
                const title = (a?.title ?? "").toLowerCase();
                const messageText = normText(a?.message);
                return this.welcomeKeywords.some(
                    (k) => title.includes(k) || messageText.includes(k)
                );
            }

            const effectiveDate = (a) => {
                const d = a?.delayed_post_at ?? a?.posted_at ?? null;
                return d ? new Date(d) : null;
            };

            const isPostedNow = (a) => {
                const postedAt = a?.posted_at ? new Date(a.posted_at) : null;
                if (!postedAt) return false;

                const delayed = a?.delayed_post_at ? new Date(a.delayed_post_at) : null;
                // If delayed_post_at exists and is in the future, it's not actually posted yet
                if (delayed && delayed > now) return false;

                return true;
            };

            const postedWhileUnpublished = announcements.filter((a) => isPostedNow(a));
            const nonWelcomeAnnouncements = announcements.filter((a) => !isWelcomeStyle(a));

            // Announcements (posted OR scheduled) that would occur before the term/course start date
            const beforeStart = (startDate instanceof Date)
            ? announcements.filter((a) => {
                const eff = effectiveDate(a);
                return eff instanceof Date && eff < startDate;
            })
            : [];

            // If nothing to warn about, pass quietly but still show green check
            if (postedWhileUnpublished.length === 0 && beforeStart.length === 0) {
                this.isMet = true;
                this.shortMessage = "Announcement timing looks good";
                return;
            }

            this.isMet = false;
            this.shortMessage = "Announcement timing needs attention";

            this.longMessage = `
      <div>
        ${
            postedWhileUnpublished.length > 0
                ? `
              <p><strong>Heads up:</strong> Announcements <em>posted while the course is unpublished</em> do <em>not</em> notify students upon later publishing.</p>
              <details>
                <summary>View announcements already posted while unpublished (${postedWhileUnpublished.length})</summary>
                <ul>
                  ${postedWhileUnpublished.map(a => `
                    <li>
                      <a target="_blank" href="/courses/${courseId}/discussion_topics/${a?.id}">
                        ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                      </a>
                      ${a?.posted_at ? ` — <em>${new Date(a.posted_at).toLocaleString()}</em>` : ""}
                    </li>
                  `).join("")}
                </ul>
              </details>
            `
            : ""
        }

        ${
            beforeStart.length > 0
                ? `
              <p><strong>Also:</strong> Some announcements are <em>posted or scheduled</em> for <strong>before the course start date</strong>. They should be scheduled on/after the start date.</p>
              <details>
                <summary>View announcements scheduled/posted before course start (${beforeStart.length})</summary>
                <ul>
                  ${beforeStart.map(a => `
                    <li>
                      <a target="_blank" href="/courses/${courseId}/discussion_topics/${a?.id}">
                        ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                      </a>
                      ${
                                    (a?.delayed_post_at || a?.posted_at)
                                    ? ` — <em>${new Date(a?.delayed_post_at ?? a?.posted_at).toLocaleString()}</em>`
                                    : ""
                                    }
                    </li>
                  `).join("")}
                </ul>
              </details>
            `
            : ""
        }

        <p>Fix: Edit the announcement(s) and set their schedule for on/after the course start date, and re-post any that were already posted while unpublished.</p>
      </div>
    `;
        }
    } */


    //Kolton Edit - lists all links that point to a different canvas course. (uses link validator tool)
    class CrossCourseLinksExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.WARNING,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
            pollIntervalMs = 2500,
            maxWaitMs = 60000,
            allowedCourseIds = ALLOWED_LINKED_COURSE_IDS,
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.pollIntervalMs = pollIntervalMs;
            this.maxWaitMs = maxWaitMs;
            this.allowedCourseIds = new Set([...allowedCourseIds].map(String));
        }

        getName() {
            return "Cross-Course Links";
        }

        async checkExpectation(courseId) {
            const body = await ensureCompletedLinkValidation(courseId, {
                startIfNeeded: true,
                maxAgeMs: 60*60*1000, //1 hour
                pollIntervalMs: this.pollIntervalMs,
                maxWaitMs: this.maxWaitMs,
            });

            const issues = body?.results?.issues || [];
            let crossCourseLinks = [];
            const contentTypes = await Promise.all(
                issues.map((issue) => this.#resolveContentType(courseId, issue))
            );

            for (const [issueIndex, issue] of issues.entries()) {
                const contentType = contentTypes[issueIndex];
                const contentName = issue?.name || "Unknown content";
                const contentUrl = issue?.content_url
                ? `${window.location.protocol}//${window.location.hostname}${issue.content_url}`
                : "";

                const invalidLinks = Array.isArray(issue?.invalid_links) ? issue.invalid_links : [];

                for (const link of invalidLinks) {
                    const rawUrl = String(link?.url || "").trim();
                    const parsed = this.#safeUrl(rawUrl);

                    if (!parsed) continue;

                    const matchedCourseId = this.#extractCourseIdFromUrl(parsed);
                    if (!matchedCourseId) continue;


                    // Keep only links pointing to a different course
                    if (String(matchedCourseId) === String(courseId)) continue;

                    if (this.allowedCourseIds.has(String(matchedCourseId))) continue;


                    crossCourseLinks.push({
                        contentType,
                        contentName,
                        contentUrl,
                        linkUrl: parsed.href,
                        linkText: link?.link_text || "",
                        reason: link?.reason || "",
                        targetCourseId: matchedCourseId,
                    });

                }
            }

            const publicCourseIds = await this.#getPublicLinkedCourseIds(crossCourseLinks);
            crossCourseLinks = crossCourseLinks.filter((item) => !publicCourseIds.has(item.targetCourseId));

            if (crossCourseLinks.length > 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = `${crossCourseLinks.length} link${crossCourseLinks.length === 1 ? "" : "s"} to other course${crossCourseLinks.length === 1 ? "" : "s"}`;

                this.longMessage = `
        <div>
          <p>Found links that point to <strong>other Canvas courses</strong> instead of this course.</p>
          <p>These often happen when content is copied from another course and links were not adjusted.</p>
          <p><strong>Note: </strong>Please allow up to an hour for changes in links to show here.</p>
          <details>
            <summary>View cross-course links (${crossCourseLinks.length})</summary>
            <ul>
              ${crossCourseLinks.map((item) => `
                <li>
                  <div>
                    <strong>${escapeHtml(item.contentName)}</strong>
                    <em style="opacity:.75;"> (${escapeHtml(item.contentType)})</em>
                  </div>
                  <div>
                    Content:
                    ${item.contentUrl ? `<a target="_blank" href="${item.contentUrl}">Open content</a>` : `<span>Unavailable</span>`}
                  </div>
                  <div>
                    Linked URL:
                    <a target="_blank" href="${item.linkUrl}">${escapeHtml(item.linkUrl)}</a>
                  </div>
                  <div>
                    Target course ID: <strong>${escapeHtml(item.targetCourseId)}</strong>
                  </div>
                  ${ item.linkText ? `<div>Link text: ${escapeHtml(item.linkText)}</div>` : "" }
				  ${ item.reason ? `<div>Reason: ${escapeHtml(item.reason)}</div>`
                  : "" }
                </li>
              `).join("")}
            </ul>
          </details>
        </div>
      `;
                return;
            }

            this.isMet = true;
            this.shortMessage = "No cross course links found";
        }

        #safeUrl(rawUrl) {
            try {
                return new URL(rawUrl, window.location.origin);
            } catch {
                return null;
            }
        }

        #extractCourseIdFromUrl(urlObj) {
            // Only treat links on this Canvas host as course links
            if (urlObj.origin !== window.location.origin) return null;

            const match = urlObj.pathname.match(/^\/courses\/(\d+)(?:\/|$)/i);
            return match ? match[1] : null;
        }

        async #resolveContentType(courseId, issue) {
            const originalType = String(issue?.type || "");
            const topicId = this.#extractDiscussionTopicId(courseId, issue?.content_url);

            if (!topicId) return originalType;

            try {
                const topic = await getDiscussionTopic(courseId, topicId);
                if (typeof topic?.is_announcement === "boolean") {
                    return topic.is_announcement ? "Announcement" : "Discussion";
                }
            } catch (error) {
                console.warn(
                    `[CR/TA] Failed to identify discussion topic ${topicId} as an announcement or discussion`,
                    error
                );
            }

            return originalType;
        }

        #extractDiscussionTopicId(courseId, contentUrl) {
            if (!contentUrl) return null;

            try {
                const parsed = new URL(contentUrl, window.location.origin);
                const match = parsed.pathname.match(/^\/courses\/(\d+)\/discussion_topics\/(\d+)(?:\/|$)/i);

                if (!match || String(match[1]) !== String(courseId)) return null;
                return match[2];
            } catch {
                return null;
            }
        }

        async #getPublicLinkedCourseIds(links) {
            const courseIds = [...new Set(links.map((item) => item.targetCourseId))];
            const publicCourseIds = new Set();

            // Bound requests when copied content references many different courses.
            for (let index = 0; index < courseIds.length; index += 5) {
                const batch = courseIds.slice(index, index + 5);
                const publicStatuses = await Promise.all(batch.map((id) => isLinkedCoursePublic(id)));
                for (const [batchIndex, isPublic] of publicStatuses.entries()) {
                    if (isPublic) publicCourseIds.add(batch[batchIndex]);
                }
            }

            return publicCourseIds;
        }
    }
    //Kolton edit - lists all unpublished assignments
    class UnpublishedAssignmentsExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.WARNING,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({ requirementType, startAt, endAt });
        }

        getName() {
            return "Published Assignments";
        }

        async checkExpectation(courseId) {
            const assignments = await this.getAssignments(courseId);

            if (assignments.length === 0) {
                this.isMet = false;
                this.shortMessage = "No assignments found";
                this.longMessage = `
        <div>
          <p>No <a href="/courses/${courseId}/assignments">assignments</a> were found.</p>
          <p>Unable to check whether assignments are published.</p>
        </div>
      `;
                return;
            }

            const unpublishedAssignments = assignments.filter((assignment) => {
                return assignment?.published === false;
            });

            if (unpublishedAssignments.length > 0) {
                this.isMet = false;
                this.shortMessage = `${unpublishedAssignments.length} unpublished assignment${unpublishedAssignments.length === 1 ? "" : "s"}`;
                this.longMessage = `
        <div>
          <p>Some assignments are still unpublished.</p>
          <p>Go to <a href="/courses/${courseId}/assignments">Assignments</a> to publish them.</p>
          <p><strong>Note:</strong> If this course doesn't require these to be published, please ignore this message.</p>
          <details>
            <summary>Unpublished assignments (${unpublishedAssignments.length})</summary>
            <div>
              ${this.createListOfAssignmentsAsHTML(courseId, unpublishedAssignments)}
            </div>
          </details>
        </div>
      `;
                return;
            }

            this.isMet = true;
            this.shortMessage = "All assignments published";
        }

        async getAssignments(courseId) {
            const assignmentGroupsWithAssignments =
                  await getAssignmentGroupsWithAssignments(courseId);

            return assignmentGroupsWithAssignments.reduce(
                (assignmentsFromGroups, group) => {
                    assignmentsFromGroups.push(...(group?.assignments ?? []));
                    return assignmentsFromGroups;
                },
                []
            );
        }

        createListOfAssignmentsAsHTML(courseId, assignments) {
            const seen = new Set();

            const listItems = assignments
            .filter((assignment) => {
                if (!assignment?.id || seen.has(assignment.id)) return false;
                seen.add(assignment.id);
                return true;
            })
            .map((assignment) => {
                return `
          <li>
            <a target="_blank" href="/courses/${courseId}/assignments/${assignment?.id}">
              ${escapeHtml(assignment?.name ?? "Untitled Assignment")}
            </a>
          </li>
        `;
            });

            return `
      <ul>
        ${listItems.join("")}
      </ul>
    `;
        }
    }
    //Kolton Edit: Check for final and midterm availability dates:
    class ExamAvailabilityExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            keywords = ["final", "midterm"],
            requiredOffsetDays = 7,
            toleranceHours = 2,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.keywords = keywords;
            this.requiredOffsetDays = requiredOffsetDays;
            this.toleranceMs = toleranceHours * 60 * 60 * 1000;
        }

        getName() {
            return "Exam Availability Dates";
        }

        async checkExpectation(courseId) {
            const norm = (s) => String(s ?? "").toLowerCase();
            const hasKeyword = (name) => {
                const n = norm(name);
                return this.keywords.some((k) => n.includes(norm(k)));
            };


            // A) ASSIGNMENTS (only quizzes OR external tools)
            const groups = await getAssignmentGroupsWithAssignments(courseId);
            const allAssignments = groups.reduce((acc, g) => {
                if (Array.isArray(g?.assignments)) acc.push(...g.assignments);
                return acc;
            }, []);

            const assignmentCandidates = allAssignments
            .filter((a) => hasKeyword(a?.name))
            .filter((a) => {
                const st = Array.isArray(a?.submission_types) ? a.submission_types : [];
                return st.includes("online_quiz") || st.includes("external_tool");
            })
            .map((a) => ({
                kind: "assignment",
                subtype: (a?.submission_types ?? []).includes("online_quiz")
                ? "quiz-assignment"
                : "external-tool-assignment",
                id: a?.id,
                quiz_id: a?.quiz_id,
                name: a?.name,
                all_dates: Array.isArray(a?.all_dates) ? a.all_dates : [],
            }));

            // B) CLASSIC QUIZZES (Canvas /quizzes endpoint)
            let quizCandidates = [];
            try {
                const quizzes = await getQuizzes(courseId);
                quizCandidates = (quizzes ?? [])
                    .filter((q) => hasKeyword(q?.title))
                    .map((q) => ({
                    kind: "quiz",
                    subtype: "classic-quiz",
                    id: q?.id,
                    assignment_id: q?.assignment_id,
                    name: q?.title,
                    unlock_at: q?.unlock_at,
                    due_at: q?.due_at,
                }));
            } catch (e) {
                console.warn("[ExamAvailability] quiz API failed", e);
            }

            quizCandidates = this.#removeClassicQuizDuplicates(quizCandidates, assignmentCandidates);

            const candidates = [...assignmentCandidates, ...quizCandidates];

            if (candidates.length === 0) {
                this.isMet = true;
                this.messageType = AlertType.INFORMATIONAL;
                this.shortMessage = "Exam availability dates configured";
                return;
            }

            // Validate dates
            const violations = [];
            const targetMs = this.requiredOffsetDays * 24 * 60 * 60 * 1000;

            // helper: check (unlock,due) pair
            const checkWindow = ({ name, id, link, unlock, due, label }) => {
                const unlockDt = unlock ? new Date(unlock) : null;
                const dueDt = due ? new Date(due) : null;

                if (!unlockDt || !dueDt) {
                    violations.push({
                        name,
                        id,
                        link,
                        issue: !unlockDt && !dueDt
                        ? "Missing Due and Available From dates."
                        : !dueDt
                        ? "Missing Due date."
                        : "Missing Available From date.",
                        label,
                    });
                    return;
                }

                const diffMs = dueDt - unlockDt;

                // allow tiny drift, but enforce at least target
                if (diffMs + this.toleranceMs < targetMs) {
                    const daysActual = diffMs / (24 * 60 * 60 * 1000);
                    violations.push({
                        name,
                        id,
                        link,
                        issue: `Availability window is ${daysActual.toFixed(
                            2
                        )} days; must be at least ${this.requiredOffsetDays} days.`,
                        label,
                    });
                }
            };

            // A) assignments (quiz-assignment / external-tool-assignment)
            for (const a of assignmentCandidates) {
                if (!a.all_dates || a.all_dates.length === 0) {
                    violations.push({
                        name: a.name,
                        id: a.id,
                        link: `/courses/${courseId}/assignments/${a.id}`,
                        issue: "Missing all_dates; cannot verify.",
                        label: a.subtype,
                    });
                    continue;
                }

                for (const d of a.all_dates) {
                    checkWindow({
                        name: a.name,
                        id: a.id,
                        link: `/courses/${courseId}/assignments/${a.id}`,
                        unlock: d?.unlock_at,
                        due: d?.due_at,
                        label: a.subtype,
                    });
                }
            }

            // B) quizzes (classic)
            for (const q of quizCandidates) {
                checkWindow({
                    name: q.name,
                    id: q.id,
                    link: `/courses/${courseId}/quizzes/${q.id}`,
                    unlock: q.unlock_at,
                    due: q.due_at,
                    label: q.subtype,
                });
            }

            const uniqueViolations = this.#dedupeViolations(violations);

            if (uniqueViolations.length > 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = "Exam availability window too short";
                this.longMessage = `
        <div>
          <p>For midterm/final <strong>quizzes</strong> or <strong>external-tool</strong> items, <em>Available From</em> must be set to <strong>at least ${this.requiredOffsetDays} days</strong> before the <em>Due</em> date.</p>
          <p><strong>Note:</strong> Some assignments might be flagged as a midterm/final, but are not actually midterms or finals.</p>
          <details>
            <summary>Items needing fixes</summary>
            <ul>
              ${uniqueViolations
                    .map(
                    (v) => `
                <li>
                  <a target="_blank" href="${v.link}">
                    ${escapeHtml(v.name ?? "Unknown")}
                  </a>
                  <em style="opacity:.75;"> (${escapeHtml(v.label)})</em>
                  – ${escapeHtml(v.issue)}
                </li>
              `
                )
                    .join("")}
            </ul>
          </details>
        </div>
      `;
                return;
            }

            this.isMet = true;
            this.shortMessage = "Exam availability dates configured";
        }

        #removeClassicQuizDuplicates(quizCandidates, assignmentCandidates) {
            const quizAssignments = assignmentCandidates.filter((a) => a.subtype === "quiz-assignment");
            const quizAssignmentIds = new Set(
                quizAssignments
                .map((a) => a.id)
                .filter((id) => id !== undefined && id !== null)
                .map(String)
            );
            const quizIds = new Set(
                quizAssignments
                .map((a) => a.quiz_id)
                .filter((id) => id !== undefined && id !== null)
                .map(String)
            );
            const quizAssignmentNameKeys = new Set(
                quizAssignments.map((a) => this.#normalizeExamName(a.name))
            );

            return quizCandidates.filter((q) => {
                if (q.assignment_id && quizAssignmentIds.has(String(q.assignment_id))) return false;
                if (q.id && quizIds.has(String(q.id))) return false;
                return !quizAssignmentNameKeys.has(this.#normalizeExamName(q.name));
            });
        }

        #dedupeViolations(violations) {
            const seen = new Set();
            return violations.filter((violation) => {
                const key = [
                    violation.label,
                    violation.id ?? "",
                    this.#normalizeExamName(violation.name),
                    violation.issue,
                ].join("|");

                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        #normalizeExamName(name) {
            return String(name ?? "")
                .toLowerCase()
                .replace(/\s+/g, " ")
                .trim();
        }
    }




    class InstructorBioExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,

            // Search Pages for this title instead of using a fixed page slug
            pageTitle = "Instructor Contact Information, Bio, and Policies",

            // placeholder checks
            requireName = true,
            requireEmail = true,
            requireBio = true,

            namePlaceholders = ["[insert name]", "[name]"],
            emailPlaceholders = ["[insert email]", "[email]"],
            bioPlaceholders = ["[insert bio]", "[bio]"],
            officeHoursPlaceholders = ["[Insert Office Hours]"],

            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({ requirementType, startAt, endAt });

            this.pageTitle = pageTitle;

            this.requireName = requireName;
            this.requireEmail = requireEmail;
            this.requireBio = requireBio;

            this.namePlaceholders = namePlaceholders;
            this.emailPlaceholders = emailPlaceholders;
            this.bioPlaceholders = bioPlaceholders;
            this.officeHoursPlaceholders = officeHoursPlaceholders;
        }

        getName() {
            return "Instructor Bio & Contact";
        }

        async checkExpectation(courseId) {
            const full = await this.#findInstructorBioPage(courseId);

            // Missing page
            if (!full || (full?.status && String(full.status).includes("not"))) {
                this.isMet = false;
                this.shortMessage = "Instructor bio/contact page missing";
                this.longMessage = `
        <div>
          <p>Expected page not found by title search:</p>
          <p><strong>${escapeHtml(this.pageTitle)}</strong></p>
          <p>Please create this Page and include the required instructor contact information.</p>
        </div>
      `;
                return;
            }

            const pageSlug = full?.url || full?.page_url || "";
            const pageHref = pageSlug
            ? `/courses/${courseId}/pages/${encodeURIComponent(pageSlug)}`
            : `/courses/${courseId}/pages`;

            // Locked page
            if (full?.locked_for_user) {
                this.isMet = false;
                this.shortMessage = "Instructor bio/contact page locked";
                this.longMessage = `
        <div>
          <p>The page appears to be locked:</p>
          <p><a target="_blank" href="${pageHref}">${escapeHtml(full?.title ?? this.pageTitle)}</a></p>
          <p>Unlock the page or update permissions so it can be validated.</p>
        </div>
      `;
            return;
        }

            const html = full?.body ?? "";
            const text = Expectation.convertHTMLToText(html);

            const issues = [];

            if (this.requireName) {
                const found = this.#findPlaceholders(text, this.namePlaceholders);
                if (found.length > 0) {
                    issues.push(`Name still contains placeholder text: ${found.join(", ")}`);
                }
            }

            if (this.requireEmail) {
                const found = this.#findPlaceholders(text, this.emailPlaceholders);
                if (found.length > 0) {
                    issues.push(`Email still contains placeholder text: ${found.join(", ")}`);
                }
            }

            if (this.requireBio) {
                const found = this.#findPlaceholders(text, this.bioPlaceholders);
                if (found.length > 0) {
                    issues.push(`Bio still contains placeholder text: ${found.join(", ")}`);
                }
            }

            {
                const found = this.#findPlaceholders(text, this.officeHoursPlaceholders);
                if (found.length > 0) {
                    issues.push(`Office Hours still contains placeholder text: ${found.join(", ")}`);
                }
            }

            if (issues.length > 0) {
                this.isMet = false;
                this.shortMessage = "Instructor bio/contact still has placeholders";
                this.longMessage = `
        <div>
          <p>Update the instructor bio/contact page and replace all placeholder text.</p>
          <p><a target="_blank" href="${pageHref}">${escapeHtml(full?.title ?? this.pageTitle)}</a></p>
          <details>
            <summary>What still needs to be replaced</summary>
            <ul>
              ${issues.map(i => `<li>${escapeHtml(i)}</li>`).join("")}
            </ul>
          </details>
        </div>
      `;
            return;
        }

            this.isMet = true;
            this.shortMessage = "Instructor bio and contact information updated";
        }

        async #findInstructorBioPage(courseId) {
            const searchUrl =
                  `${window.location.protocol}//${window.location.hostname}` +
                  `/api/v1/courses/${courseId}/pages` +
                  `?search_term=${encodeURIComponent(this.pageTitle)}` +
                  `&per_page=100`;

            const searchResults = await fetch(searchUrl, {
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json",
                },
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Failed to search pages for instructor bio/contact page (HTTP ${response.status})`);
                }

                return response.json();
            });

            const pages = Array.isArray(searchResults) ? searchResults : [];

            const exactMatch = pages.find(page =>
                                          String(page?.title ?? "").trim().toLowerCase() === this.pageTitle.trim().toLowerCase()
                                         );

            const fallbackMatch = pages.find(page =>
                                             String(page?.title ?? "").trim().toLowerCase().includes(this.pageTitle.trim().toLowerCase())
                                            );

            const page = exactMatch || fallbackMatch;

            if (!page?.url) {
                return null;
            }

            return getPage(courseId, page.url);
        }

        #findPlaceholders(text, placeholders) {
            const normalizedText = String(text ?? "").toLowerCase();

            return placeholders.filter(placeholder =>
                                       normalizedText.includes(String(placeholder ?? "").trim().toLowerCase())
                                      );
        }
    }


    //Kolton Edit: Instructor information/bio check - look above for the placeholder implementation ^^^ (commented out for now
    /*     class InstructorBioExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            pageSlug = "instructor-contact-information-bio-and-policies",
            requireName = true,
            requireEmail = true,
            requireBio = true,
            minBioWords = 20,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.pageSlug = pageSlug;
            this.requireName = requireName;
            this.requireEmail = requireEmail;
            this.requireBio = requireBio;
            this.minBioWords = minBioWords;
        }

        getName() {
            return "Instructor Bio & Contact";
        }

        async checkExpectation(courseId) {
            // Fetch ONLY the specified page
            const full = await getPage(courseId, this.pageSlug);

            const pageHref = `/courses/${courseId}/pages/${encodeURIComponent(this.pageSlug)}`;

            // Missing page
            if (!full || (full?.status && String(full.status).includes("not"))) {
                this.isMet = false;
                this.shortMessage = "Instructor bio/contact page missing ";
                this.longMessage = `
        <div>
          <p>Expected page not found:</p>
          <p><a target="_blank" href="${pageHref}">instructor-contact-information-bio-and-policies</a></p>
          <p>Please create this Page and include the required fields.</p>
        </div>
      `;
                return;
            }

            // Locked page
            if (full?.locked_for_user) {
                this.isMet = false;
                this.shortMessage = "Instructor bio/contact page locked ";
                this.longMessage = `
        <div>
          <p>The page appears to be locked:</p>
          <p><a target="_blank" href="${pageHref}">${escapeHtml(full?.title ?? this.pageSlug)}</a></p>
          <p>Unlock the page or update permissions so it can be validated.</p>
        </div>
      `;
                return;
            }

            const html = full?.body ?? "";
            const text = Expectation.convertHTMLToText(html);

            // Validate labeled fields
            const nameOk   = !this.requireName  ? true : this.#hasLabeledValue(text, /name:/i);
            const emailOk  = !this.requireEmail ? true : this.#hasValidEmail(text);
            const bioCheck = !this.requireBio   ? { ok: true, words: 0 } : this.#bioWordsAfterLabel(text, /bio:/i);

            const issues = [];
            if (!nameOk)  issues.push("Missing or empty “Name:”");
            if (!emailOk) issues.push("Missing or invalid “Email:”");
            if (this.requireBio && (!bioCheck.ok || bioCheck.words < this.minBioWords)) {
                issues.push(`“Bio:” must be at least ${this.minBioWords} words (found ${Math.max(0, bioCheck.words)}).`);
            }

            if (issues.length > 0) {
                this.isMet = false;
                this.shortMessage = "Instructor bio/contact incomplete";
                this.longMessage = `
        <div>
          <p>Update the page so it includes labeled fields <strong>Name:</strong>, <strong>Email:</strong>, and a <strong>Bio:</strong> section with at least ${this.minBioWords} words.</p>
          <p><a target="_blank" href="${pageHref}">${escapeHtml(full?.title ?? this.pageSlug)}</a></p>
          <details>
            <summary>What’s missing</summary>
            <ul>
              ${issues.map(i => `<li>${escapeHtml(i)}</li>`).join("")}
            </ul>
          </details>
        </div>
      `;
                return;
            }

            // Success
            this.isMet = true;
            this.shortMessage = "Instructor bio/contact page ready for review ";
        }

        // --- helpers ---

        #hasLabeledValue(text, labelRegex) {
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
                const m = line.match(labelRegex);
                if (m) {
                    const after = line.slice(m.index + m[0].length).trim();
                    if (after.length > 0) return true;
                }
            }
            return false;
        }

        #hasValidEmail(text) {
            const emailAfterLabel = this.#valueAfterLabel(text, /email:/i);
            const candidate = (emailAfterLabel || text);
            const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
            return emailRe.test(candidate);
        }

        #valueAfterLabel(text, labelRegex) {
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
                const m = line.match(labelRegex);
                if (m) {
                    return line.slice(m.index + m[0].length).trim();
                }
            }
            return "";
        }

        #bioWordsAfterLabel(text, labelRegex) {
            const idx = text.search(labelRegex);
            if (idx === -1) return { ok: false, words: 0 };

            const m = text.match(labelRegex);
            const after = text.slice(idx + m[0].length);

            // Stop at the next obvious label on its own line (e.g., "Late Work Policy:")
            const nextLabelMatch = after.match(/^[ \t]*[A-Za-z].{0,60}?:\s*$/m);
            const segment = nextLabelMatch ? after.slice(0, nextLabelMatch.index) : after;

            const cleaned = segment.replace(/\s+/g, " ").trim();
            const words = cleaned.length ? cleaned.split(" ").length : 0;
            return { ok: words > 0, words };
        }
    }
 */


    //Kolton Edit: check for all students in group if group assignment
    class GroupProjectMembershipExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            assignmentKeywords = ["GRS", "GRC", "GRP"],
            startAt = 4,                   // active 4 days after course start
            endAt = Expectation.NA,
            maxListNames = 15,             // cap names shown in the error list
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.assignmentKeywords = assignmentKeywords;
            this.maxListNames = maxListNames;
        }

        getName() {
            return "Group Project Membership";
        }

        async checkExpectation(courseId) {
            // 1) Do we have any group-project assignments at all?
            const groupsWithAssignments = await getAssignmentGroupsWithAssignments(courseId);
            const allAssignments = groupsWithAssignments.flatMap(g => g?.assignments ?? []);
            const hasGroupProject = allAssignments.some(a => {
                const name = (a?.name ?? "").toLowerCase();
                return this.assignmentKeywords.some(k => name.includes(k.toLowerCase()));
            });

            if (!hasGroupProject) {
                // Nothing to enforce → hide this check
                this._suppress = true;
                return;
            }

            // 2) Collect active students in the course
            const students = await getCourseStudents(courseId); // active student enrollments
            const studentIds = new Set(students.map(s => s?.id).filter(Boolean));

            if (studentIds.size === 0) {
                // No students = nothing to enforce
                this.isMet = true;
                this.messageType = AlertType.INFORMATIONAL;
                this.shortMessage = "Students assigned to groups";
                return;
            }

            // 3) Union of users in any course group
            const courseGroups = await getGroupsForCourse(courseId);
            const groupedStudentIds = new Set();

            for (const g of courseGroups) {
                const users = await getGroupUsers(g?.id);
                for (const u of users) {
                    if (u?.id && studentIds.has(u.id)) groupedStudentIds.add(u.id);
                }
            }

            // 4) Find students not in any group
            const missing = students.filter(
                s => s?.id && !groupedStudentIds.has(s.id) && s?.name !== "Test Student"
            );

            if (missing.length > 0) {
                const shown = missing.slice(0, this.maxListNames);
                const extra = missing.length - shown.length;
                const instructorInstructionsUrl = await getInstructorInstructionsPageUrl(courseId);

                this.isMet = false;
                this.messageType = this.type; // ERROR for MANDATORY
                this.shortMessage = `Students missing groups (${missing.length}) `;
                this.longMessage = `
        <div>
          <p>Assignments marked as group projects detected (names containing: <code>${this.assignmentKeywords.join(", ")}</code>).</p>
          <p>All students must be placed in a group.</p>
          <details>
            <summary>View students not in any group (${missing.length})</summary>
            <ul>
              ${shown
                    .map(
                    s => `<li>${escapeHtml(s?.name ?? "Unknown")} (${escapeHtml(
                        s?.login_id ?? s?.sortable_name ?? ""
                    )})</li>`
                )
                    .join("")}
            </ul>
            ${extra > 0 ? `<p>…and ${extra} more.</p>` : ""}
          </details>
          <p>Go to the <a target="_blank" href="/courses/${courseId}/groups">Groups</a> tab to add them to a group.</p>
          <p><b>Note:</b> Try to have groups setup no later than week two of the term unless otherwise stated in your <a href="${escapeHtml(instructorInstructionsUrl)}">Information for Instructors</a>. For information on group assignment and how to set them please refer to our <a href="https://erau.instructure.com/courses/39211/pages/canvas-groups">ERAU Canvas Groups Guide</a></p>
        </div> 
      `;
                return;
            }

            // 5) Passed
            this.isMet = true;
            this.shortMessage = "Students assigned to groups";
        }
    }

    /*     //Kolton Edit: Check for Welcome announcement.
    class WelcomeAnnouncementExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            keywords = ["welcome", "greetings"],
            requireTeacherAsAuthor = false,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.keywords = (Array.isArray(keywords) ? keywords : [keywords])
                .map((k) => String(k).toLowerCase())
                .filter(Boolean);
            this.requireTeacherAsAuthor = requireTeacherAsAuthor;
        }

        getName() {
            return "Welcome Announcement";
        }

        async checkExpectation(courseId) {
            const announcements = await getCourseAnnouncements(courseId);

            if (!Array.isArray(announcements) || announcements.length === 0) {
                this.isMet = false;
                this.messageType = this.type; // keep severity consistent
                this.shortMessage = "No welcome announcement found";
                this.longMessage = `
        <div>
          <p>No <a href='/courses/${courseId}/announcements'>announcements</a> are available to check for a welcome message.</p>
          <p>Please create a Welcome announcement and <strong>schedule</strong> it with <i>Available From</i> set to the Term/Course Start date.</p>
        </div>
      `;
                return;
            }

            const [startDate] = await getCourseStudentParticipationDates(courseId);

            // Optionally require author to be a teacher in this course
            let filtered = announcements;
            if (this.requireTeacherAsAuthor) {
                const courseDetails = await getCourseDetails(courseId);
                const teachers = courseDetails?.teachers ?? [];
                filtered = filtered.filter((a) => {
                    const authorId = a?.author?.id;
                    return !!authorId && teachers.some((t) => t?.id == authorId);
                });
            }

            const normText = (html) =>
            Expectation.convertHTMLToText(html ?? "").toLowerCase();

            const matchesKeyword = (a) => {
                const title = (a?.title ?? "").toLowerCase();
                const messageText = normText(a?.message);
                return this.keywords.some((k) => title.includes(k) || messageText.includes(k));
            };

            // All welcome-ish announcements (regardless of scheduling)
            const welcomeCandidates = filtered.filter(matchesKeyword);

            // If none exist at all => this is the TRUE "missing welcome" case
            if (welcomeCandidates.length === 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = "No welcome-style announcement found";
                this.longMessage = `
        <div>
          <p>No <a href='/courses/${courseId}/announcements'>announcement</a> was found containing a welcome-style keyword
          (${this.keywords.map(k => `“${escapeHtml(k)}”`).join(", ")}).</p>
          <p>Please create a welcome announcement so students see it on day one.</p>
          <p>If scheduling, set <strong>Available From</strong> to the term/course start date.</p>
        </div>
      `;
                return;
            }

            // Scheduled = has delayed_post_at (Canvas "Available From")
            const scheduled = welcomeCandidates.filter((a) => !!a?.delayed_post_at);

            // If welcome exists but NONE are scheduled => show ONLY the "not scheduled" warning (not missing)
            if (scheduled.length === 0) {
                this.isMet = false;
                this.messageType = AlertType.INFORMATIONAL;
                this.shortMessage = "Welcome announcement not scheduled";
                this.longMessage = `
        <div>
          <p>A welcome-style announcement was found, but it is <strong>not scheduled</strong> (no <i>Available From</i> date).</p>
          <p>This can prevent it from notifying students at the right time. It is <strong>recommended</strong> to edit the announcement and set <strong>Available From</strong> to the Term/Course Start date.</p>
          <details>
            <summary>Welcome announcements found (${welcomeCandidates.length})</summary>
            <ul>
              ${welcomeCandidates.map(a => `
                <li>
                  <a target="_blank" href="/courses/${courseId}/discussion_topics/${a?.id}">
                    ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                  </a>
                  ${a?.posted_at ? ` — <em>posted: ${new Date(a.posted_at).toLocaleString()}</em>` : ""}
                </li>
              `).join("")}
            </ul>
          </details>
        </div>
      `;
                return;
            }


            // If we have a start date, require the scheduled date to be on/after start
            if (startDate instanceof Date) {
                const scheduledOnOrAfterStart = scheduled.filter((a) => {
                    const dt = new Date(a.delayed_post_at);
                    return dt >= startDate;
                });

                if (scheduledOnOrAfterStart.length === 0 || scheduled.length === 0) {
                    const effectiveDate = (a) => {
                        const d = a?.delayed_post_at ?? a?.posted_at ?? null;
                        return d ? new Date(d) : null;
                    };

                    const nonWelcomeBeforeStart = announcements.filter((a) => {
                        if (welcomeCandidates.some((w) => w?.id == a?.id)) return false;
                        const eff = effectiveDate(a);
                        return eff instanceof Date && eff < startDate;
                    });
                    this.isMet = false;
                    this.messageType = AlertType.INFORMATIONAL;
                    this.shortMessage = "Welcome announcement scheduled too early";
                    this.longMessage = `
          <div>
            <p>A welcome-style announcement is scheduled, but it is scheduled <strong>before</strong> the course start date.</p>
            <p>It is <strong>recommended</strong> to update its <strong>Available From</strong> date to be on/after the Term/Course Start date so students receive it appropriately.</p>
            ${
                    nonWelcomeBeforeStart.length>0
                        ? `
                    <p><strong>Also:</strong> some other announcments are posted or scheduled for before the course start date.</p>
                        <details>
                        <summary>Other announcements before course start (${nonWelcomeBeforeStart.length})</summary>
                <ul>
                            ${nonWelcomeBeforeStart.map((a) => `
                                                       <li>
                                                        <a target="_blank href="/courses/${courseId}/discussion_topics/${a?.id}">
                ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                </a>
                ${
                    (() => {
                        const eff = effectiveDate(a);
                        return eff ? ` — <em>effective: ${eff.toLocaleString()}</em>` : "";
                    })()
                                                        }
                    </li>
                    `).join("")}
                    </ul>
                    </details>
                    `
                    : ""
                }

            <details>
              <summary>Welcome announcements scheduled before start (${scheduled.length})</summary>
              <ul>
                ${scheduled.map(a => `
                  <li>
                    <a target="_blank" href="/courses/${courseId}/discussion_topics/${a?.id}">
                      ${a?.title ? escapeHtml(a.title) : "Untitled Announcement"}
                    </a>
                    ${a?.delayed_post_at ? ` — <em>scheduled: ${new Date(a.delayed_post_at).toLocaleString()}</em>` : ""}
                  </li>
                `).join("")}
              </ul>
            </details>
          </div>
        `;
                    return;
                }
            }

            // Passed: welcome exists and is scheduled appropriately
            this.isMet = true;
            this.messageType = AlertType.INFORMATIONAL;
            this.shortMessage = "Welcome announcement scheduled";
        }
    } */




    class AssignmentDueDatesExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            requireForZeroPointAssignments = false,
            requireForAssignmentsNotAffectingFinalGrade = false,
            requireDueDateAfterCourseStartDate = true,
            requireDueDateBeforeCourseEndDate = true,
            startAt = Expectation.NA,
            endAt = Expectation.NA,
        } = {}) {
            super({
                requirementType,
                startAt,
                endAt,
            });
            this.requireForZeroPointAssignments = requireForZeroPointAssignments; // If false, assignments that are 0 points won't require a due date set
            this.requireForAssignmentsNotAffectingFinalGrade =
                requireForAssignmentsNotAffectingFinalGrade; // If false, assignments that are set to not affect the final grade, have a grading type of not graded, and/or are in a 0% assignment weight group won't require a due date set
            this.requireDueDateAfterCourseStartDate =
                requireDueDateAfterCourseStartDate;
            this.requireDueDateBeforeCourseEndDate =
                requireDueDateBeforeCourseEndDate;
        }

        getName() {
            return "Due Dates";
        }

        async checkExpectation(courseId) {
            let assignments = await this.getAssignments(courseId);

            if (assignments.length == 0) {
                this.isMet = false;
                this.shortMessage = "Missing assignment(s)";
                this.longMessage = `
          <div>
                        <p>No <a href='/courses/${courseId}/assignments'>assignments</a> were found.</p>
                            <p>Unable to check due date expectation since there are no assignments.</p>
                    </div>
                    `;
                return;
            }

            if (!this.requireForAssignmentsNotAffectingFinalGrade) {
                assignments = assignments.filter((assignment) => {
                    return (
                        !assignment["omit_from_final_grade"] &&
                        assignment["grading_type"] != "not_graded"
                    );
                });
            }

            if (!this.requireForZeroPointAssignments) {
                assignments = assignments.filter((assignment) => {
                    return (assignment?.points_possible ?? 0) > 0;
                });
            }

            const assignmentsWithDueDates = assignments.filter((assignment) => {
                const allDueDates = assignment["all_dates"];
                return allDueDates.every((dueDate) => {
                    return !!dueDate?.due_at;
                });
            });

            const assignmentsMissingDueDates = assignments.filter((assignment) => {
                const allDueDates = assignment["all_dates"];
                return !allDueDates.every((dueDate) => {
                    return !!dueDate?.due_at;
                });
            });

            if (assignmentsWithDueDates.length == 0) {
                this.isMet = false;
                this.shortMessage = "No due dates set";
                this.longMessage = `
          <div>
                <p>No due dates have been set on assignments.</p>
                    <p>Go to <a href='/courses/${courseId}/assignments">assignments</a> to set due dates</p>
                    </div>
                    `;
                return;
            }

            if (
                this.requireDueDateAfterCourseStartDate ||
                this.requireDueDateBeforeCourseEndDate
            ) {
                const assignmentsWithInvalidDueDates =
                      await this.removeAssignmentsWithValidDueDates(
                          courseId,
                          assignmentsWithDueDates
                      );

                if (assignmentsWithInvalidDueDates.length > 0) {
                    this.isMet = false;
                    this.shortMessage = "Invalid due dates";
                    this.longMessage = `
            <div>
                <p>Assignments were found with invalid due dates.</p>
                    <p>Go to <a href='/courses/${courseId}/assignments'>assignments</a> to make sure all due dates are ${
                    this.requireDueDateBeforeCourseEndDate &&
                        this.requireDueDateAfterCourseStartDate
                        ? "within course dates"
                    : this.requireDueDateAfterCourseStartDate
                        ? "after the course start date"
                    : "before the course end date"
                }.</p>
                <details>
                    <summary>Assignments with Invalid Due Dates</summary>
                <div>
                        ${this.createListOfAssignmentsAsHTML(
                        courseId,
                        assignmentsWithInvalidDueDates
                    )}
                </div>
                </details>
                </div>
                `;
                    return;
                }
            }

            const numOfAssignments = assignments.length;
            const numOfAssignmentsWithDueDates = assignmentsWithDueDates.length;

            if (numOfAssignments > numOfAssignmentsWithDueDates) {
                const percentageComplete = Math.floor(
                    (numOfAssignmentsWithDueDates * 100) / numOfAssignments
                );
                this.isMet = false;
                this.shortMessage = `${percentageComplete}% of due dates set`;
                this.longMessage = `
          <div>
                    <p>There are assignments missing a due date.</p>
                <p>Go to <a href='/courses/${courseId}/assignments'>assignments</a> to update assignment(s) missing due dates.</p>
                    <details>
                    <summary>Assignments Missing Due Dates</summary>
                <div>
                        ${this.createListOfAssignmentsAsHTML(
                    courseId,
                    assignmentsMissingDueDates
                )}
                </div>
                </details>
                </div>
                `;
                return;
            }

            // Passed all checks
            this.isMet = true;
            this.shortMessage = "Due dates ready for review";
        }

        async getAssignments(courseId) {
            const courseDetails = await getCourseDetails(courseId);
            const usesWeightGroups =
                  courseDetails?.apply_assignment_group_weights || false;
            let assignmentWeightGroupsWithAssignments =
                await getAssignmentGroupsWithAssignments(courseId);
            if (
                !this.requireForAssignmentsNotAffectingFinalGrade &&
                usesWeightGroups
            ) {
                assignmentWeightGroupsWithAssignments =
                    assignmentWeightGroupsWithAssignments.filter((group) => {
                    return (group?.group_weight ?? 0) > 0;
                });
            }

            return assignmentWeightGroupsWithAssignments.reduce(
                (assignmentsFromGroups, group) => {
                    assignmentsFromGroups.push(...(group?.assignments ?? []));
                    return assignmentsFromGroups;
                },
                []
            );
        }

        async removeAssignmentsWithValidDueDates(courseId, assignments) {
            const [startDate, endDate] = await getCourseStudentParticipationDates(
                courseId
            );
            return assignments.filter((assignment) => {
                const allDueDates = assignment["all_dates"];

                for (const dueDate of allDueDates) {
                    if (!dueDate["due_at"]) {
                        return true;
                    } else if (
                        this.requireDueDateAfterCourseStartDate &&
                        startDate instanceof Date &&
                        new Date(dueDate["due_at"]) < startDate
                    ) {
                        return true;
                    } else if (
                        this.requireDueDateBeforeCourseEndDate &&
                        endDate instanceof Date &&
                        new Date(dueDate["due_at"]) > endDate
                    ) {
                        return true;
                    }
                }
                return false;
            });
        }

        createListOfAssignmentsAsHTML(courseId, assignments) {
            const listItems = assignments.map((assignment) => {
                return `
          <li>
                  <a target='_blank' href='/courses/${courseId}/assignments/${assignment?.id}'>${assignment?.name}</a>
                </li>
                `;
            });

            return `
        <ul>
                ${listItems.join("")}
                </ul>
                `;
        }
    }

    class AssignmentGradeWeightsExpectation extends Expectation {
        constructor({
            requirementType = RequirementType.MANDATORY,
            expectedTotal = 100,
            tolerance = 0.01,
            startAt = Expectation.NA,
            endAt = Expectation.COURSE_START, // only run before course start by default
        } = {}) {
            super({ requirementType, startAt, endAt });
            this.expectedTotal = expectedTotal;
            this.tolerance = tolerance;
        }

        getName() {
            return "Assignment Grade Weights";
        }

        async checkExpectation(courseId) {
            const courseDetails = await getCourseDetails(courseId);
            const usesWeightGroups = !!courseDetails?.apply_assignment_group_weights;

            // If the course is not using weighted assignment groups, this check is irrelevant.
            if (!usesWeightGroups) {
                this._suppress = true;
                return;
            }

            const groups = await getAssignmentGroupsWithAssignments(courseId);
            const safeGroups = Array.isArray(groups) ? groups : [];

            if (safeGroups.length === 0) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = "No assignment groups found";
                this.longMessage = `
        <div>
            <p>This course is set to use <strong>Assignment Group Weights</strong>, but no assignment groups were found.</p>
                <p>Go to <a href="/courses/${courseId}/assignments">Assignments</a> to create assignment groups and set their weights.</p>
                    </div>
                `;
                return;
            }

            const weightedGroups = safeGroups.map((g) => ({
                id: g?.id,
                name: g?.name ?? "Unnamed Group",
                weight: Number(g?.group_weight ?? 0),
            }));

            const totalWeight = weightedGroups.reduce((sum, g) => sum + g.weight, 0);
            const roundedTotal = Math.round(totalWeight * 100) / 100;

            if (Math.abs(totalWeight - this.expectedTotal) > this.tolerance) {
                this.isMet = false;
                this.messageType = this.type;
                this.shortMessage = `Grade weights total ${roundedTotal}%`;

                this.longMessage = `
        <div>
                    <p>The <strong>Assignment Grade Weights</strong> do not add up to <strong>${this.expectedTotal}%</strong>.</p>
                <p>Current total: <strong>${roundedTotal}%</strong></p>
                    <p>Go to <a href="/courses/${courseId}/assignments">Assignments</a> and update the Assignment Group Weights so they total ${this.expectedTotal}%.</p>
                        <p><strong>Note:</strong> If this course doesn't require the grade weights to total <strong>${this.expectedTotal}%</strong>, please ignore this message.</p>
                <details>
                            <summary>View assignment group weights</summary>
                <ul>
                                ${weightedGroups
                    .map(
                    (g) => `
                <li>
                  ${escapeHtml(g.name)} — ${g.weight}%
                </li>
              `
                )
                    .join("")}
                </ul>
                </details>
                </div>
                `;
                return;
            }

            this.isMet = true;
            this.messageType = AlertType.INFORMATIONAL;
            this.shortMessage = "Assignment group weights total 100%";
        }
    }

    //   class TimelyGradingExpectation extends Expectation {
    //     constructor({
    //       requirementType = RequirementType.MANDATORY,
    //       maxDaysUngraded = 8,
    //       requireForZeroPointAssignments = false,
    //       requireForAssignmentsNotAffectingFinalGrade = false,
    //       startAt = Expectation.NA,
    //       endAt = Expectation.NA,
    //     } = {}) {
    //       super({
    //         requirementType,
    //         startAt,
    //         endAt,
    //       });
    //       this.maxDaysUngraded = maxDaysUngraded; // This is the maximum number of days an assignment should be left ungraded before a warning. If a due date is set on the assignment, this will count from the due date rather than the submission date if the submission date is before the due date.  Late submissions and/or submissions on assignments without a due date will calculate from the submission date.
    //       this.requireForZeroPointAssignments = requireForZeroPointAssignments;
    //       this.requireForAssignmentsNotAffectingFinalGrade =
    //         requireForAssignmentsNotAffectingFinalGrade; // If false, assignments that are set to not affect the final grade, have a grading type of not graded, and/or are in a 0% assignment weight group won't require a due date set
    //     }

    //     getName() {
    //       return "Timely Grading";
    //     }

    //     async checkExpectation(courseId) {
    //       let assignments = await this.getAssignments(courseId);

    //       if (assignments.length == 0) {
    //         this.isMet = false;
    //         this.shortMessage = "Missing assignment(s)";
    //         this.longMessage = `
    //           <div>
    //             <p>No <a href='/courses/${courseId}/assignments'>assignments</a> were found.</p>
    //             <p>Unable to check timely grading expectation since there are no assignments.</p>
    //           </div>
    //         `;
    //         return;
    //       }

    //       if (!this.requireForAssignmentsNotAffectingFinalGrade) {
    //         assignments = assignments.filter((assignment) => {
    //           return (
    //             !assignment["omit_from_final_grade"] &&
    //             assignment["grading_type"] != "not_graded"
    //           );
    //         });
    //       }

    //       if (!this.requireForZeroPointAssignments) {
    //         assignments = assignments.filter((assignment) => {
    //           return (assignment?.points_possible ?? 0) > 0;
    //         });
    //       }

    //       if (assignments.length == 0) {
    //         this.isMet = false;
    //         this.shortMessage = "Missing assignments";
    //         this.longMessage = `
    //           <div>
    //             <p>No <a href='/courses/${courseId}/assignments'>assignments</a> were found meeting expectations.</p>
    //             <p>Unable to check timely grading expectation since there are no assignments meeting expectations.</p>
    //           </div>
    //         `;
    //         return;
    //       }

    //       const submittedSubmissions = await getSubmissions(courseId, "submitted");
    //       const overdueSubmittedSubmissions = this.filterSubmissions(
    //         submittedSubmissions,
    //         assignments
    //       );

    //       if (overdueSubmittedSubmissions.length > 0) {
    //         this.isMet = false;
    //         this.shortMessage = "Overdue grading";
    //         this.longMessage = `
    //           <div>
    //             <p>Found submissions overdue for grading</p>
    //             <p>Submssions should be graded with ${this.maxDaysUngraded} days</p>
    //             <details>
    //               <summary>Assignments with Submissions Overdue for Grading</summary>
    //               <div>
    //                 ${this.createListOfAssignmentsWithOverdueGradingAsHTML(
    //                   courseId,
    //                   assignments,
    //                   overdueSubmittedSubmissions
    //                 )}
    //               </div>
    //             </details>
    //           </div>
    //         `;
    //         return;
    //       }

    //       let pendingReviewSubmissions = await getSubmissions(
    //         courseId,
    //         "pending_review"
    //       );
    //       const overduePendingReviewSubmissions = this.filterSubmissions(
    //         pendingReviewSubmissions,
    //         assignments
    //       );

    //       if (overduePendingReviewSubmissions.length > 0) {
    //         this.isMet = false;
    //         this.shortMessage = "Overdue grading";
    //         this.longMessage = `
    //           <div>
    //             <p>Found submissions overdue for grading</p>
    //             <p>Submssions should be graded with ${this.maxDaysUngraded} days</p>
    //             <details>
    //               <summary>Assignments with Submissions Overdue for Grading</summary>
    //               <div>
    //                 ${this.createListOfAssignmentsWithOverdueGradingAsHTML(
    //                   courseId,
    //                   assignments,
    //                   overduePendingReviewSubmissions
    //                 )}
    //               </div>
    //             </details>
    //           </div>
    //         `;
    //         return;
    //       }

    //       // Passed checkes
    //       this.isMet = true;
    //       this.shortMessage = "Grading ready for review";
    //     }

    //     async getAssignments(courseId) {
    //       const courseDetails = await getCourseDetails(courseId);
    //       const usesWeightGroups =
    //         courseDetails?.apply_assignment_group_weights || false;
    //       let assignmentWeightGroupsWithAssignments =
    //         await getAssignmentGroupsWithAssignments(courseId);
    //       if (
    //         !this.requireForAssignmentsNotAffectingFinalGrade &&
    //         usesWeightGroups
    //       ) {
    //         assignmentWeightGroupsWithAssignments =
    //           assignmentWeightGroupsWithAssignments.filter((group) => {
    //             return (group?.group_weight ?? 0) > 0;
    //           });
    //       }

    //       return assignmentWeightGroupsWithAssignments.reduce(
    //         (assignmentsFromGroups, group) => {
    //           assignmentsFromGroups.push(...(group?.assignments ?? []));
    //           return assignmentsFromGroups;
    //         },
    //         []
    //       );
    //     }

    //     filterSubmissions(submissions, assignmentsToInclude) {
    //       return submissions.filter((submission) => {
    //         // Exclude submissions that aren't for an assignment meeting expectation requirements
    //         if (
    //           !assignmentsToInclude.find((assignment) => {
    //             return assignment?.id == submission?.assignment_id;
    //           })
    //         ) {
    //           return false;
    //         }

    //         // Exclude submission that are excused and/or submitted by "Test Student"
    //         if (submission?.excused || submission?.user?.name == "Test Student") {
    //           return false;
    //         }

    //         // Check if the date is within the timely grading
    //         const oldestDateTimeAllowed = new Date();
    //         oldestDateTimeAllowed.setDate(
    //           oldestDateTimeAllowed.getDate() - this.maxDaysUngraded
    //         );

    //         const dueDate = submission?.cached_due_date;
    //         const submissionDate = submission?.submitted_at;
    //         const dateToCheck =
    //           !!dueDate && new Date(dueDate) > new Date(submissionDate)
    //             ? new Date(dueDate)
    //             : new Date(submissionDate);
    //         return dateToCheck < oldestDateTimeAllowed;
    //       });
    //     }

    //     createListOfAssignmentsWithOverdueGradingAsHTML(
    //       courseId,
    //       assignments,
    //       overdueSubmissions
    //     ) {
    //       const overdueAssignmentIds = [
    //         ...new Set(
    //           overdueSubmissions.map((submission) => {
    //             return submission?.assignment_id;
    //           })
    //         ),
    //       ];

    //       const listItems = overdueAssignmentIds.map((id) => {
    //         const assignment = assignments.find((assignment) => {
    //           return assignment?.id == id;
    //         });
    //         if (!assignment) {
    //           return "<li>Unknown Assignment</li>";
    //         }

    //         return `
    //           <li>
    //             <a target='_blank' href='/courses/${courseId}/assignments/${id}'>${assignment?.name}</a>
    //           </li>
    //         `;
    //       });

    //       return `
    //         <ul>
    //           ${listItems.join("")}
    //         </ul>
    //       `;
    //     }
    //   }

    const expectations = [
        //new PublishedCourseExpectation(), - Kolton EDIT - removing old checks from ui
        //new CourseDatesExpectation(),
        /*new SyllabusFileExpectation({
      requirementType: RequirementType.WARNING,
      partialFileLinkText: "syllabus",
      isTeacherRequiredToUploadToCourse: true,
    }),*/
        // New warning (only shows when unpublished; hidden otherwise)
        new CombinedAnnouncementExpectation({
            requirementType: RequirementType.WARNING,
            keywords: ["welcome", "greetings"],
            requireTeacherAsAuthor: false,
        }),
        //new unpublished assignment expectation
        new UnpublishedAssignmentsExpectation({
            requirementType: RequirementType.WARNING,
        }),


        //New link check.
        new CrossCourseLinksExpectation({
            requirementType: RequirementType.WARNING,
            startAt: Expectation.NA,
        }),

        /*
    new AnnouncementExpectation({
      requirementType: RequirementType.WARNING,
      endAt: Expectation.COURSE_START,
    }),*/
        new GroupProjectMembershipExpectation({//Kolton Edit
            requirementType: RequirementType.WARNING,
            assignmentKeywords: ["GRS", "GRC", "GRP"],
            startAt: Expectation.NA, // enforce beginning 4 days after course start
        }),

        new ExamAvailabilityExpectation({ //Kolton Edit
            requirementType: RequirementType.MANDATORY, // or WARNING
            keywords: ["final", "midterm", "summative", "mid-term"],
            requiredOffsetDays: 7,
            toleranceHours: 2, // adjust for stricter or looser matching
            //startAt: 0, // active from course start (omit if you want always active)
        }),
        new InstructorBioExpectation({ //Kolton Edit
            requirementType: RequirementType.MANDATORY, // or WARNING
            pageSlug: "instructor-contact-information-bio-and-policies",
            minBioWords: 20, // adjust as desired
            // startAt / endAt omitted so it runs always
        }),

        new AssignmentGradeWeightsExpectation({ //Kolton Edit
            requirementType: RequirementType.WARNING,
            startAt: Expectation.NA,
            endAt: Expectation.NA,
        }),

        /*new AnnouncementExpectation({ - Kolton EDIT - removing old checks from ui
      startAt: 0,
      maxDaysSinceLastPost: 7,
    }),*/
        //new AssignmentDueDatesExpectation(),
        //     new TimelyGradingExpectation({
        //       startAt: 0,
        //     }),
    ];

    if (/^\/courses\/[0-9]+\??[^\/]*\/?$/.test(window.location.pathname)) {
        // Don't load if a student of the course (even if teacher or admin)
        if (isStudentOfThisCourse()) return;

        // Don't load if the user isn't a teacher of the course and they aren't an admin with the necessary permissions
        if (!isTeacherOfThisCourse() && !(isAdmin() && hasNecessaryPermissions())) return;

        const courseId = window.location.pathname.split("/")[2];

        // Only enforce parent-account filtering and unpublished-only behavior when STOP_AFTER_PUBLISHED is enabled
        if (STOP_AFTER_PUBLISHED === true) {
            const allowedParentAccount = await isAllowedParentAccount(courseId);
            if (!allowedParentAccount) {
                console.log("[CR/TA] Exiting: course is not under an allowed parent account");
                return;
            }

            // Always fetch live workflow_state before deciding to stop
            const freshState = await getCourseWorkflowStateFresh(courseId);
            if (freshState && freshState !== "unpublished") {
                console.log("[CR/TA] Stop-after-published: early exit (state=", freshState, ")");
                return;
            }
        }

        // From here on it's fine to use cached details
        const courseDetails = await getCourseDetails(courseId);

        // (Optional) If you don't need term filtering, keep it commented out
        // const termDetails = await getEnrollmentTerm(courseDetails?.enrollment_term_id);

        // Determine start/end based on course settings/term
        const [startDate, endDate] = await getCourseStudentParticipationDates(courseId);

        const activeExpectations = expectations.filter((e) => e.isActiveExpectation(startDate, endDate));
        if (activeExpectations.length === 0) return;

        if (document.getElementById("wu-course-readiness-alerts-wrapper") || document.querySelector(".wu-checklist")) {
            console.warn("[CR/TA] Existing course readiness UI found; skipping duplicate render.");
            return;
        }

        const topAlertsHolder = addAlertsPlaceholder();
        const rightSideChecklist = addRightSideChecklist();

        try {
            const jobs = activeExpectations.map((e) =>
                                                loadExpectation(e, courseId, topAlertsHolder)
                                               );
            await Promise.all(jobs);

            const visibleExpectations = activeExpectations.filter((e) => e._suppress !== true);
            const allVisibleExpectationsMet = visibleExpectations.length > 0 && visibleExpectations.every((e) => e.isMet === true);
            if (allVisibleExpectationsMet) {
                const readyAlert = createAlert(ALL_SETUP_ITEMS_READY_MESSAGE, AlertType.INFORMATIONAL);
                topAlertsHolder.insertAdjacentElement("beforeend", readyAlert);
            }

            renderCourseStatusChecklist(rightSideChecklist, activeExpectations);
        } catch (err) {
            console.error("Failed to process all expectations\n", err);
            renderCourseStatusChecklist(rightSideChecklist, activeExpectations);
        }
    }

    function isTeacherOfThisCourse() {
        return ENV?.COURSE?.is_instructor ?? false;
    }

    function isStudentOfThisCourse() {
        return ENV?.COURSE?.is_student ?? false;
    }

    function isAdmin() {
        return ENV?.current_user_is_admin ?? false;
    }

    async function hasNecessaryPermissions() {
        const courseId = window.location.pathname.split("/")[2];
        const permissions = await getCoursePermissions(courseId);
        return (
            permissions?.read_as_admin &&
            permissions?.read_course_content &&
            permissions?.read_syllabus &&
            permissions?.read_files &&
            permissions?.read_announcements &&
            permissions?.read_roster &&
            permissions?.view_all_grades
        );
    }

    async function getCoursePermissions(courseId) {
        const pageResponse = await getRequestLinksAndResults(
            `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/permissions`
    );

            if (pageResponse) {
                return pageResponse?.results;
            } else {
                return {};
            }
        }

    function isAuditedTerm(termDetails) {
        const termTitle = termDetails?.name;
        if (!termTitle) {
            return false;
        }

        return (
            termTitle.includes("Fall") ||
            termTitle.includes("Spring") ||
            termTitle.includes("Summer")
        );
    }

    async function getCourseStudentParticipationDates(courseId) {
        const courseDetails = await getCourseDetails(courseId);
        const term = await getEnrollmentTerm(courseDetails?.enrollment_term_id);

        const useCourseDates = courseDetails?.restrict_enrollments_to_course_dates;
        const startAt = useCourseDates ? courseDetails?.start_at : term?.start_at;
        const endAt = useCourseDates ? courseDetails?.end_at : term?.end_at;
        const startDate = !!startAt ? new Date(startAt) : null;
        const endDate = !!endAt ? new Date(endAt) : null;
        return [startDate, endDate];
    }

    //Kolton Edit - Changed this around so I could "hide all warnings"
    function addAlertsPlaceholder() {
        const recentAnnouncementsDiv = document.getElementById("announcements_on_home_page");
        const courseHomeContentDiv = document.getElementById("course_home_content");
        const topCourseHomeDiv = recentAnnouncementsDiv ? recentAnnouncementsDiv : courseHomeContentDiv;

        const wrapper = document.createElement("div");
        wrapper.id = "wu-course-readiness-alerts-wrapper";
        wrapper.style.position = "relative";
        wrapper.style.marginBottom = "1rem";
        wrapper.style.backgroundColor = "#fff";

        const pilotFeedbackBox = document.createElement("div");
        pilotFeedbackBox.id = "wu-pilot-feedback-top";
        pilotFeedbackBox.style.display = SHOW_PILOT_FEEDBACK_BOX ? "block" : "none";
        pilotFeedbackBox.style.boxSizing = "border-box";
        pilotFeedbackBox.style.marginBottom = "0.5rem";
        pilotFeedbackBox.style.padding = "0.55rem 0.75rem";
        pilotFeedbackBox.style.border = "1px solid #d8dde6";
        pilotFeedbackBox.style.borderLeft = "4px solid var(--ic-brand-primary)";
        pilotFeedbackBox.style.borderRadius = "6px";
        pilotFeedbackBox.style.backgroundColor = "#fff";
        pilotFeedbackBox.style.color = "#2d3b45";
        pilotFeedbackBox.style.fontSize = "0.875rem";
        pilotFeedbackBox.style.lineHeight = "1.4";
        pilotFeedbackBox.innerHTML = `
        <strong>Course Readiness Status:</strong>
        This tool helps faculty spot setup items that may need attention.
        Please send issues or feedback to <a target="_blank" rel="noopener noreferrer" href="${PILOT_FEEDBACK_URL}">
            ${PILOT_FEEDBACK_LABEL}</a>.
    `;

            const topControlsRow = document.createElement("div");
            topControlsRow.style.display = "flex";
            topControlsRow.style.gap = "8px";
            topControlsRow.style.alignItems = "stretch";
            topControlsRow.style.flexWrap = "wrap";
            topControlsRow.style.justifyContent = "flex-end";
            topControlsRow.style.marginBottom = "0.5rem";

            const setupBox = document.createElement("div");
            setupBox.id = "wu-setup-instructions-top";
            setupBox.style.display = "none";
            setupBox.style.padding = "6px 10px";
            setupBox.style.border = "1px solid #d8dde6";
            setupBox.style.borderRadius = "6px";
            setupBox.style.backgroundColor = "#f8f9fa";
            setupBox.style.fontSize = "0.8rem";
            setupBox.style.lineHeight = "1.35";
            setupBox.innerHTML = `
        Need help preparing this course? Review the
        <a target="_blank" rel="noopener noreferrer" href="${SETUP_INSTRUCTIONS_URL}">
            ${SETUP_INSTRUCTIONS_LABEL}</a>.
    `;

            const hideAll = document.createElement("button");
            hideAll.id = "wu-hide-all-warnings";
            hideAll.textContent = "Hide All Warnings";
            hideAll.classList.add("Button", "Button--secondary");
            hideAll.style.backgroundColor = "#f5f5f5";
            hideAll.style.border = "1px solid #ccc";
            hideAll.style.color = "#2d3b45";
            hideAll.style.fontSize = "0.8rem";
            hideAll.style.padding = "4px 10px";
            hideAll.style.borderRadius = "4px";
            hideAll.style.cursor = "pointer";
            hideAll.style.display = "none";

            hideAll.addEventListener("mouseover", () => (hideAll.style.backgroundColor = "#ececec"));
            hideAll.addEventListener("mouseout", () => (hideAll.style.backgroundColor = "#f5f5f5"));

            hideAll.addEventListener("click", () => {
                wrapper.querySelectorAll("div.alert-item").forEach((el) => (el.style.display = "none"));
                hideAll.style.display = "none";
                toggleSetupInstructionBoxes();
            });

            topControlsRow.appendChild(setupBox);
            topControlsRow.appendChild(hideAll);
            wrapper.appendChild(pilotFeedbackBox);
            wrapper.appendChild(topControlsRow);

            if (topCourseHomeDiv) {
                topCourseHomeDiv.insertAdjacentElement("beforebegin", wrapper);
            }

            return wrapper;
        }


    function createAlert(message, type, isDismissable = true) {
        let color = "#0374B5";
        let icon = `<i class='icon-solid icon-info-borderless' aria-hidden='true'></i>`;
        if (type == AlertType.WARNING) {
            color = "#fc5e13";
            icon = `<i class='icon-solid icon-warning-borderless' aria-hidden='true'></i>`;
        } else if (type == AlertType.ERROR) {
            color = "#e0061f";
            icon = `<i class='icon-solid icon-warning-borderless' aria-hidden='true'></i>`;
        } else if (type == AlertType.INFORMATIONAL) {
            color = "var(--ic-brand-primary)";
        }

        const alert = document.createElement("div");
        alert.classList.add("alert-item");   // Kolton Edit
        alert.style.marginTop = "0.5rem";
        alert.style.marginBottom = "0.5rem";
        alert.style.border = `1px solid ${color}`;
        alert.style.borderRadius = "5px";
        alert.style.display = "flex";
        alert.style.boxSizing = "border-box";

        const iconWrapper = document.createElement("div");
        iconWrapper.style.backgroundColor = color;
        iconWrapper.style.color = "white";
        iconWrapper.style.alignItems = "center";
        iconWrapper.style.display = "flex";
        iconWrapper.style.flex = "0 0 2.5rem";
        iconWrapper.style.justifyContent = "center";
        iconWrapper.innerHTML = icon;

        const alertContentWrapper = document.createElement("div");
        alertContentWrapper.style.minWidth = 0;
        if (!isDismissable) {
            alertContentWrapper.innerHTML = message;
        } else {
            alertContentWrapper.style.flex = "1 1 auto";
            alertContentWrapper.style.display = "flex";
            alertContentWrapper.style.justifyContent = "space-between";
            alertContentWrapper.style.padding = "0.5rem 0.5rem 0.5rem 1rem";

            const messageWrapper = document.createElement("div");
            messageWrapper.style.minWidth = 0;
            messageWrapper.innerHTML = message;

            const dismissButtonWrapper = document.createElement("div");
            dismissButtonWrapper.style.minWidth = "2rem";
            dismissButtonWrapper.style.textAlign = "center";
            const dismissButton = document.createElement("button");
            dismissButton.classList.add("Button", "Button--icon-action");
            dismissButton.innerHTML = `<i class="icon-x" title="Hide this alert"></i>`;
            dismissButton.addEventListener("click", () => {
                alert.style.display = "none";
            });
            dismissButtonWrapper.append(dismissButton);

            alertContentWrapper.append(messageWrapper);
            alertContentWrapper.append(dismissButtonWrapper);
        }

        alert.append(iconWrapper);
        alert.append(alertContentWrapper);

        return alert;
    }

    function addRightSideChecklist() {
        const rightSideChecklist = document.createElement("div");
        rightSideChecklist.classList.add("wu-checklist");
        rightSideChecklist.innerHTML = `
		

      <div>
        <h2 style="margin-top: 1.0625rem;">
          <span tabindex="-1">
            ${HEADING_FOR_CHECKLIST ?? "Teaching Expectations"}
          </span>
        </h2>
        <div id="wu-course-status-rightside" wrap="normal" letter-spacing="normal">
          <div class="wu-checklist-loading"><i class='icon-Solid icon-info' aria-hidden='true'></i> <em>Loading</em></div>
        </div>

        <div id="wu-setup-instructions-right"
             style="display:none; margin-top: 1rem; padding: 0.75rem; border: 1px solid #d8dde6; border-radius: 6px; background: #f8f9fa; font-size: 0.9rem; line-height: 1.4;">
          Need help preparing this course? Review the
          <a target="_blank" rel="noopener noreferrer" href="${SETUP_INSTRUCTIONS_URL}">
           ${SETUP_INSTRUCTIONS_LABEL}</a>.
        </div>
      </div>
    `;

            const courseHomeRightSideButtonsDiv = document.getElementById("course_show_secondary");
            courseHomeRightSideButtonsDiv?.insertAdjacentElement("afterend", rightSideChecklist);

            return rightSideChecklist;
        }

    function renderCourseStatusChecklist(rightSideChecklist, expectationsToRender) {
        const statusHolder = rightSideChecklist.querySelector("#wu-course-status-rightside");
        if (!statusHolder) return;

        const visibleExpectations = expectationsToRender.filter((e) => e._suppress !== true);
        const needsAttentionExpectations = visibleExpectations.filter((e) => e.isMet !== true);
        const totalChecks = visibleExpectations.length;
        const passedChecks = totalChecks - needsAttentionExpectations.length;
        const isReadyForReview = totalChecks > 0 && passedChecks === totalChecks;
        const statusColor = isReadyForReview ? "#0374B5" : "#b35c00";
        const statusText = isReadyForReview ? "Ready for review" : "Needs attention";
        const evidenceHtml = isReadyForReview
        ? ""
        : `
          <div style="color: #5f6368; font-size: 0.875rem; margin-bottom: 0.85rem;">
            ${passedChecks} of ${totalChecks} automated checks passed
          </div>
        `;

        statusHolder.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0 0.35rem;">
            <span aria-hidden="true" style="width: 0.75rem; height: 0.75rem; border-radius: 999px; background: ${statusColor}; display: inline-block; flex: 0 0 auto;"></span>
            <strong style="color: #2d3b45; font-size: 1rem;">${statusText}</strong>
          </div>
          ${evidenceHtml}
          <div id="wu-course-status-details"></div>
        `;

        const detailsHolder = statusHolder.querySelector("#wu-course-status-details");
        if (!detailsHolder) return;

        if (needsAttentionExpectations.length > 0) {
            detailsHolder.append(createChecklistGroup("Needs Attention", needsAttentionExpectations));
        }
    }

    function createChecklistGroup(title, expectationsToRender) {
        const group = document.createElement("div");
        group.style.marginTop = "0.75rem";

        const heading = document.createElement("h3");
        heading.textContent = title;
        heading.style.fontSize = "0.875rem";
        heading.style.fontWeight = "700";
        heading.style.margin = "0 0 0.35rem";
        heading.style.color = "#2d3b45";
        group.append(heading);

        const list = document.createElement("ul");
        list.classList.add("unstyled");
        list.style.margin = "0";
        list.style.padding = "0";

        for (const expectation of expectationsToRender) {
            list.append(createChecklistItem(
                expectation.shortMessage,
                expectation.messageType,
                expectation.isMet
            ));
        }

        group.append(list);
        return group;
    }

    function createChecklistItem(message, type, isMet) {
        const listItem = document.createElement("li");
        const attentionIcon = createAttentionIconSvg();
        listItem.style.marginBottom = "0.3rem";
        listItem.style.lineHeight = "1.3";
        if (isMet) {
            listItem.classList.add("text-success");
            listItem.style.color = "#2d3b45";
            listItem.innerHTML = `
        <span aria-hidden="true" style="color: #0b874b; font-weight: 700;">✓</span> ${message}
      `;
            } else if (type == AlertType.ERROR) {
            listItem.classList.add("text-error");
            listItem.style.color = "#2d3b45";
            listItem.innerHTML = `
        ${attentionIcon} ${message}
      `;
        } else if (type == AlertType.WARNING) {
            listItem.classList.add("text-warning");
            listItem.style.color = "#2d3b45";
            listItem.innerHTML = `
        ${attentionIcon} ${message}
      `;
        } else if (type == AlertType.INFORMATIONAL) {
            listItem.style.color = "#2d3b45";
            listItem.innerHTML = `
        ${attentionIcon} ${message}
      `;
        } else {
            listItem.innerHTML = `
        ${attentionIcon} ${message}
      `;
        }

            return listItem;
        }

    function createAttentionIconSvg() {
        return `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="1.05em" height="1.05em" style="vertical-align: -0.16em; color: currentColor; flex: 0 0 auto;">
          <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2.2"></circle>
          <path d="M12 6.8v7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"></path>
          <circle cx="12" cy="17.6" r="1.45" fill="currentColor"></circle>
        </svg>`;
    }

    async function loadExpectation(
    expectation,
     courseId,
     topAlert
    ) {
        try {
            await expectation.checkExpectation(courseId);

            if (expectation._suppress === true) {
                return;
            }

            if (!expectation.isMet) {
                const alert = createAlert(expectation.longMessage, expectation.messageType);
                topAlert.insertAdjacentElement("beforeend", alert);

                const hideBtn = document.getElementById("wu-hide-all-warnings");
                if (hideBtn) hideBtn.style.display = "inline-block";
            }

            toggleSetupInstructionBoxes();
        } catch (error) {
            console.error(`Failed to process exception: ${expectation}\n${error}`);
            expectation.isMet = false;
            expectation.shortMessage = `Error with ${expectation.getName()} check`;
            expectation.messageType = AlertType.ERROR;
            toggleSetupInstructionBoxes();
        }
    }


    async function getRequestLinksAndResults(url) {
        let results = [];
        let links = {};

        const fetches = [];

        fetches.push(
            fetch(url)
            .then((response) => {
                let headerLinks = response.headers.get("link")?.split(",");
                if (headerLinks) {
                    for (let link of headerLinks) {
                        let splitLink = link.split("; rel=");
                        links[splitLink[1].replaceAll('"', "")] = splitLink[0]
                            .replace("<", "")
                            .replace(">", "");
                    }
                }
                return response.json();
            })
            .then((data) => {
                results = data;
            })
            .catch((error) => {
                console.error("Error:", error);
            })
        );

        await Promise.all(fetches);

        return {
            results: results,
            links: links,
        };
    }

    async function getPaginatedRequestResults(url) {
        const completeResults = [];
        let pageResults = {};

        let currentUrl = url;
        do {
            pageResults = await getRequestLinksAndResults(currentUrl);
            if (pageResults.hasOwnProperty("results")) {
                if (Array.isArray(pageResults.results)) {
                    completeResults.push(...pageResults.results);
                } else {
                    completeResults.push(pageResults.results);
                }
            }

            if (
                pageResults.hasOwnProperty("links") &&
                pageResults.links.hasOwnProperty("next")
            ) {
                currentUrl = pageResults.links.next;
            } else {
                currentUrl = "";
            }
        } while (currentUrl != "");

        return completeResults;
    }

    function memoizeRequest(key, requestFunction) {
        if (cache.has(key)) {
            return cache.get(key);
        }

        cache.set(
            key,
            requestFunction().catch((error) => {
                cache.delete(key);
                return Promise.reject(error);
            })
        );

        return cache.get(key);
    }

    //KOLTON EDIT - API HELPERS

    function toggleSetupInstructionBoxes() {
        const visibleAlerts = Array.from(
            document.querySelectorAll("#wu-course-readiness-alerts-wrapper .alert-item")
        ).filter((el) => el.style.display !== "none");

        const shouldShow = visibleAlerts.length > 0;

        const topBox = document.getElementById("wu-setup-instructions-top");
        const rightBox = document.getElementById("wu-setup-instructions-right");

        if (topBox) {
            topBox.style.display = shouldShow ? "block" : "none";
        }

        if (rightBox) {
            rightBox.style.display = "block";
        }
    }
    function getAccount(accountId) {
        return memoizeRequest(`account_${accountId}`, () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/accounts/${accountId}`;
            return fetch(url)
                .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch account ${accountId} (HTTP ${response.status})`);
                }
                return response.json();
            });
        });
    }

    function isLinkedCoursePublic(courseId) {
        return memoizeRequest(`linked_course_public_${courseId}`, async () => {
            try {
                const response = await fetch(`/api/v1/courses/${courseId}`, {
                    credentials: "same-origin",
                    headers: { "Accept": "application/json" },
                });
                if (!response.ok) return false;

                const course = await response.json();
                // Only public course visibility qualifies, not a public syllabus or institution-only access.
                return course?.is_public === true;
            } catch (error) {
                console.warn(`[CR/TA] Unable to verify public visibility for linked course ${courseId}`, error);
                return false;
            }
        });
    }

    async function isAllowedParentAccount(courseId) {
        const courseDetails = await getCourseDetails(courseId);
        const subAccountId = courseDetails?.account_id;
        if (!subAccountId) return false;

        const subAccount = await getAccount(subAccountId);
        const parentAccountId = String(subAccount?.parent_account_id ?? "");

        return ALLOWED_PARENT_ACCOUNT_IDS.has(parentAccountId);
    }

    const LINK_VALIDATION_REFRESH_MS = 60*60*1000; //1 hour
    function getLinkValidationCompletedAt(body){
        const candidates = [
            body?.updated_at,
            body?.completed_at,
            body?.finished_at,
            body?.results?.updated_at,
        ].filter(Boolean);
        const parsed = candidates
        .map((value) => new Date(value))
        .find((date) => !Number.isNaN(date.getTime()));

        return parsed ?? null;
    }

    function isLinkValidationFresh(body, maxAgeMs = LINK_VALIDATION_REFRESH_MS){
        if(body?.workflow_state !== "completed") return false;

        const completedAt = getLinkValidationCompletedAt(body);
        if(!completedAt) return false;

        return (Date.now() - completedAt.getTime()) < maxAgeMs;
    }

    function getCsrfToken() {
        const cookieMatch = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
        if (cookieMatch?.[1]) {
            return decodeURIComponent(cookieMatch[1]);
        }

        const metaToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
        if (metaToken) {
            return metaToken;
        }

        return null;
    }

    async function startLinkValidation(courseId) {
        const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/link_validation`;
        const csrfToken = getCsrfToken();

        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
            },
        });

        let body = null;
        try {
            body = await response.json();
        } catch {
            try {
                body = await response.text();
            } catch {
                body = null;
            }
        }

        if (!response.ok) {
            console.error("Link validation start failed:", {
                status: response.status,
                body,
            });
            throw new Error(
                `Failed to start link validation (HTTP ${response.status})` +
                (body?.errors ? `: ${JSON.stringify(body.errors)}` : "")
            );
        }

        return body || {};
    }

    function getLinkValidation(courseId, { noStore = false } = {}) {
        const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/link_validation`;

        return fetch(url, {
            credentials: "same-origin",
            cache: noStore ? "no-store" : "default",
            headers: {
                "Accept": "application/json",
            },
        })
            .then(async (response) => {
            if (!response.ok) {
                throw new Error(`Failed to fetch link validation (HTTP ${response.status})`);
            }
            return response.json().catch(() => ({}));
        })
            .catch((error) => {
            console.error("Error fetching link validation:", error);
            throw error;
        });
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function ensureCompletedLinkValidation(
    courseId,
     {
        startIfNeeded = true,
        forceRefresh = false,
        maxAgeMs = LINK_VALIDATION_REFRESH_MS,
        pollIntervalMs = 2500,
        maxWaitMs = 60000,
    } = {}
    ) {
        let body = await getLinkValidation(courseId, { noStore: true });

        if (body?.workflow_state === "completed"){
            const completedAt = getLinkValidationCompletedAt(body);
            const isFresh = completedAt && (Date.now() - completedAt.getTime()) < maxAgeMs;

            if(!forceRefresh && isFresh){
                return body;
            }

            if(!forceRefresh && startIfNeeded){
                startLinkValidation(courseId).catch((err) => {
                    console.warn("Background link validation refresh failed:", err);
                });
                return body;
            }
        }

        if (!startIfNeeded){
            return body;
        }


        await startLinkValidation(courseId);

        const startedAt = Date.now();
        while(Date.now() - startedAt < maxWaitMs){
            await sleep(pollIntervalMs);
            body = await getLinkValidation(courseId, {noStore: true});
            if (body?.workflow_state === "completed"){
                return body;
            }
            if (body?.workflow_state === "failed" || body?.workflow_state === "error"){
                throw new Error('Link validation ended in state: ${body.workflow_state');
            }
        }
        throw new Error('Timed out waiting for link validation to complete');
    }
    async function findSimpleSyllabusTab(courseId) {
        // 1) Try official API
        try {
            const tabs = await getTabs(courseId);
            if (Array.isArray(tabs)) {
                const hit = tabs.find(t => {
                    const label = (t?.label || t?.id || "").toLowerCase();
                    const isExternal =
                          t?.type === "external" || (t?.id || "").startsWith("context_external_tool_");
                    const brandedHints = ["simple syllabus", "simple-syllabus"];
                    const looksLikeSyllabus =
                          label.includes("syllabus") || brandedHints.some(h => label.includes(h));
                    const looksLikeExternalToolsLink =
                          (t?.html_url || "").includes(`/courses/${courseId}/external_tools/`);

                    return isExternal && (looksLikeSyllabus || looksLikeExternalToolsLink);
                });

                if (hit) return hit;
            }
        } catch (e) {
            console.warn("tabs lookup failed", e);
        }

        // 2) Fallback: scan the current page for a visible link to the tool
        // (useful when the nav tab is hidden but the course links to the tool from Home/Modules)
        try {
            const anchors = Array.from(document.querySelectorAll("a[href*='/external_tools/']"));
            const courseAnchors = anchors.filter(a => (a.getAttribute("href") || "").includes(`/courses/${courseId}/external_tools/`));
            const hit = courseAnchors.find(a => {
                const txt = (a.textContent || "").toLowerCase();
                return txt.includes("syllabus") || txt.includes("simple");
            });
            if (hit) {
                return {
                    id: "dom_detected_simple_syllabus",
                    type: "external",
                    hidden: false,
                    label: hit.textContent?.trim() || "Simple Syllabus",
                    html_url: hit.getAttribute("href"),
                };
            }
        } catch (e) {
            console.warn("dom fallback failed", e);
        }

        return null;
    }

    async function tabHtmlReachable(url) {
        try {
            const resp = await fetch(url, { method: "GET", redirect: "follow" });
            return !!resp?.ok;
        } catch {
            return false;
        }
    }


    function getInstructorInstructionsPageUrl(courseId) {
        return memoizeRequest(`instructor_instructions_url_${courseId}`, async () => {
            const modulesUrl = `/courses/${courseId}/modules`;
            try {
                const modules = await getPaginatedRequestResults(
                    `/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`
                );
                for (const module of modules) {
                    const items = Array.isArray(module?.items)
                        ? module.items
                        : await getPaginatedRequestResults(
                            `/api/v1/courses/${courseId}/modules/${module.id}/items?per_page=100`
                        );
                    const page = items.find((item) =>
                        item?.type === "Page" &&
                        String(item?.page_url ?? "").toLowerCase().includes("setup-and-grading-instructions")
                    );
                    if (page) {
                        const moduleContext = page.id ? `?module_item_id=${encodeURIComponent(page.id)}` : "";
                        return `/courses/${courseId}/pages/${encodeURIComponent(page.page_url)}${moduleContext}`;
                    }
                }
            } catch (error) {
                console.warn(`[CR/TA] Unable to find instructor instructions for course ${courseId}`, error);
            }
            return modulesUrl;
        });
    }

    function getCourseStudents(courseId) {
        // Active student enrollments only
        return memoizeRequest("students", () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/users?enrollment_type[]=student&enrollment_state[]=active&per_page=100&include[]=enrollments`;
            return getPaginatedRequestResults(url);
        });
    }

    function getGroupsForCourse(courseId) {
        return memoizeRequest("course-groups", () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/groups?per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }

    function getGroupUsers(groupId) {
        return memoizeRequest(`group-${groupId}-users`, () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/groups/${groupId}/users?per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }

    // tiny helper to keep messages safe
    function escapeHtml(s) {
        return String(s ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function getPages(courseId) { //Kolton Edit api helper
        return memoizeRequest("pages", () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/pages?per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }

    function getPage(courseId, pageSlug) { //Kolton Edit api helper
        // Returns a single page with full body
        return memoizeRequest(`page_${pageSlug}`, () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageSlug)}`;
            return fetch(url)
                .then(r => r.json())
                .catch(e => { console.error("Error:", e); });
        });
    }

    function getQuizzes(courseId) {
        return memoizeRequest(`quizzes_${courseId}`, () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/quizzes?per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }

    function getCourseDetails(courseId) {
        return memoizeRequest(`course-details-${courseId}`, () => {//kolton edit
            const url = `/api/v1/courses/${courseId}?include[]=teachers&include[]=syllabus_body`;
            return fetch(url).then(r => r.json()).catch(console.error);
        });
    }

    async function getCourseWorkflowStateFresh(courseId) { //Kolton edit
        const url = `/api/v1/courses/${courseId}`;
        const resp = await fetch(url, { cache: "no-store" }); // bypass browser cache
        if (!resp.ok) return null;
        const data = await resp.json();
        return data?.workflow_state ?? null;
    }


    function getEnrollmentTerm(termId) {
        return memoizeRequest(`term_${termId}`, () => {
            const url = `/api/v1/accounts/self/terms/${termId}`;
            const course = fetch(url)
            .then((response) => {
                return response.json();
            })
            .catch((error) => {
                console.error("Error:", error);
            });
            return course;
        });
    }

    function getTabs(courseId) {
        return memoizeRequest(`tabs_${courseId}`, () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/tabs?per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }


    function getCourseAnnouncements(courseId) {
        return memoizeRequest(`announcements_${courseId}`, async () => {
            const discussionAnnouncementsUrl = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=100`;
            const announcementsUrl = `${window.location.protocol}//${window.location.hostname}/api/v1/announcements?context_codes[]=course_${courseId}&per_page=100`;
            const [discussionAnnouncements, announcements] = await Promise.all([
                getPaginatedRequestResultsSafely(discussionAnnouncementsUrl, "course discussion announcements"),
                getPaginatedRequestResultsSafely(announcementsUrl, "announcements endpoint"),
            ]);

            return dedupeAnnouncements([
                ...(Array.isArray(discussionAnnouncements) ? discussionAnnouncements : []),
                ...(Array.isArray(announcements) ? announcements : []),
            ]);
        });
    }

    async function getPaginatedRequestResultsSafely(url, label) {
        try {
            return await getPaginatedRequestResults(url);
        } catch (error) {
            console.warn(`[CR/TA] Failed to fetch ${label}`, error);
            return [];
        }
    }

    function dedupeAnnouncements(announcements) {
        const seen = new Set();

        return announcements.filter((announcement) => {
            const key = announcement?.id
            ? `id:${announcement.id}`
            : [
                "fallback",
                String(announcement?.title ?? "").toLowerCase().trim(),
                announcement?.posted_at ?? "",
                announcement?.delayed_post_at ?? "",
            ].join("|");

            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function getDiscussions(courseId) {
        return memoizeRequest(`discussions_${courseId}`, () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/discussion_topics?per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }

    function getDiscussionTopic(courseId, topicId) {
        return memoizeRequest(`discussion_topic_${courseId}_${topicId}`, async () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/discussion_topics/${topicId}`;
            const response = await fetch(url, {
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json",
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch discussion topic ${topicId} (HTTP ${response.status})`);
            }

            return response.json();
        });
    }

    function getAssignmentGroupsWithAssignments(courseId) {
        return memoizeRequest("assignments-in-groups", () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/assignment_groups?include[]=assignments&include[]=all_dates&per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }

    function getSubmissions(courseId, workflowState) {
        return memoizeRequest(`submissions-${workflowState}`, () => {
            const url = `${window.location.protocol}//${window.location.hostname}/api/v1/courses/${courseId}/students/submissions?student_ids[]=all&workflow_state=${workflowState}&include[]=user&per_page=100`;
            return getPaginatedRequestResults(url);
        });
    }

    async function getFile(courseId, fileId) {
        const url = `/api/v1/courses/${courseId}/files/${fileId}?include[]=user`;
        const fileDetails = await getRequestLinksAndResults(url);
        return fileDetails;
    }

    function convertMsToDays(milliseconds) {
        return milliseconds / 1000 / 60 / 60 / 24;
    }
})();
