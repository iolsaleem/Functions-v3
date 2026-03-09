// Azure Functions v4 entry point
// This file imports every function module so the runtime registers them all.

import './backfill';
import './backfillHttp';
import './calendarSync';
import './delegateAction';
import './emailAction';
import './emailSync';
import './emailWebhook';
import './getCalendar';
import './getEmailById';
import './getEmails';
import './getMorningBrief';
import './getTeams';
import './health';
import './morning-brief';
import './ragQuery';
import './reclassify';
import './renew-webhooks';
import './snoozeWakeup';
import './teamsSync';
