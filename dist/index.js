"use strict";
// Azure Functions v4 entry point
// This file imports every function module so the runtime registers them all.
Object.defineProperty(exports, "__esModule", { value: true });
require("./backfill");
require("./backfillHttp");
require("./calendarSync");
require("./delegateAction");
require("./emailAction");
require("./emailSync");
require("./emailWebhook");
require("./getCalendar");
require("./getEmailById");
require("./getEmails");
require("./getMorningBrief");
require("./getTeams");
require("./health");
require("./morning-brief");
require("./ragQuery");
require("./reclassify");
require("./renew-webhooks");
require("./snoozeWakeup");
require("./teamsSync");
//# sourceMappingURL=index.js.map