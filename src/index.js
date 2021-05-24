'use strict';

const { google } = require('googleapis');
const { IncomingWebhook } = require('@slack/webhook');
const path = require('path');
const parseArgs = require('yargs-parser');
const argv = parseArgs(process.argv.slice(2));

const tests = require('./tests.js');

const build = {
  reason: process.env.BUILD_REASON,
};

const account = { accountId: argv.account };
const container = { containerId: argv.container };

const commands = ['review', 'publish']; //list of commands to check if are present in the workspace name.
const commandsRegex = new RegExp('^(.+) \\((' + commands.join('|') + ')\\)$'); //create regex to check workspace name agains list of commands. Users need to insert keywords in parenthesis on the workspace name to avoid triggering pipeline by mistake

/**
 * Builds a tagmanager object
 * @param {string} credentialPath
 * @returns {tagmanager_v2.Tagmanager}
 */
async function buildTagManager(credentialPath) {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, credentialPath),
    scopes: [
      'https://www.googleapis.com/auth/tagmanager.publish',
      'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
      'https://www.googleapis.com/auth/tagmanager.edit.containers',
    ],
  });
  const client = await auth.getClient();

  const tagmanager = google.tagmanager({
    version: 'v2',
    auth: client,
  });

  return tagmanager;
}

/**
 * Defines a Slack channel based on the command issued
 * @param {Object} workspace
 */
function assignSlackChannel(workspace) {
  workspace.pipeline.channel = {};
  if (workspace.pipeline.command.name == 'publish') {
    workspace.pipeline.channel.name = '#t-ae-collaboration';
  } else {
    workspace.pipeline.channel.name = '#t-analytics-engineer';
  }

  if (typeof build.reason == 'string' && build.reason != 'Schedule') {
    workspace.pipeline.channel.message = 'Channel: ' + workspace.pipeline.channel.name;

    workspace.pipeline.channel.name = '#temp-gtm-publishing-assistant';
  }
}

/**
 * Collects all workspaces that have a command issued and are waiting for an action. For those that are waiting for an action, collects a high level list of the changes.
 * @param {tagmanager_v2.Tagmanager} tagmanager
 * @param {RegExp} commandsRegex
 * @param {string} accountId
 * @param {string} containerId
 */
async function scanWorkspaces(tagmanager, commandsRegex, accountId, containerId) {
  const parent = 'accounts/' + accountId + '/containers/' + containerId;

  //Create array to store the workspaces with changes that need to be evaluated
  let workspaces = [];

  //Query API to get list of changes for corresponding workspace
  const workspacesList = (
    await tagmanager.accounts.containers.workspaces.list({
      parent: parent,
    })
  ).data.workspace;

  //Check if workspace has one of the "command" keywords and it has been changed in the pre-defined time frame. If so, stores the workspace details, command and list of changes in an object that gets pushed to the workspaces array
  await Promise.all(
    workspacesList.map(async (workspace) => {
      const workspaceNameParsed = commandsRegex.exec(workspace.name);
      if (workspaceNameParsed) {
        workspace.pipeline = {};
        workspace.pipeline.startTime = new Date().getTime();
        workspace.pipeline.versionName = workspaceNameParsed[1];
        workspace.pipeline.command = { name: workspaceNameParsed[2] };

        let workspaceStatus = (
          await tagmanager.accounts.containers.workspaces.getStatus({
            path: workspace.path,
          })
        ).data;

        workspace = Object.assign(workspace, workspaceStatus);
        workspaces.push(workspace);
      }
    })
  );

  return workspaces;
}

/**
 * Constructs a message for a command.
 * @param {Object} workspace
 */
function buildCommandMessage(workspace) {
  workspace.pipeline.command.message =
    '*' +
    workspace.pipeline.command.name +
    '* requested for <https://tagmanager.google.com/#/container/' +
    workspace.path +
    '|' +
    workspace.name +
    '>';
}

/**
 * Syncs a workspace to the latest container version by updating all unmodified workspace entities and displaying conflicts for modified entities.
 * Creates a fake container version from all entities in the provided workspace.
 * @param {*} tagmanager
 * @param {*} workspace
 */
async function syncWorkspace(tagmanager, workspace) {
  const workspacePreview = (
    await tagmanager.accounts.containers.workspaces.quick_preview({
      path: workspace.path,
    })
  ).data;

  workspace = Object.assign(workspace, workspacePreview);

  workspace.pipeline.sync = {};
  workspace.pipeline.sync.message = 'Sync: ';

  if (workspace.syncStatus?.mergeConflict) {
    workspace.pipeline.sync.passed = false;
    workspace.pipeline.sync.message += workspace.pipeline.sync.status + '. Merge conflicts found.';
  } else if (workspace.syncStatus?.syncError) {
    workspace.pipeline.sync.passed = false;
    workspace.pipeline.sync.message += workspace.pipeline.sync.status + '. Error while syncing.';
  } else if (workspace.compilerError) {
    workspace.pipeline.sync.passed = false;
    workspace.pipeline.sync.message += workspace.pipeline.sync.status + '. Compiler errors found.';
  } else if (typeof workspace.compilerError == 'undefined' && typeof workspace.syncStatus == 'undefined') {
    workspace.pipeline.sync.message += workspace.pipeline.sync.status + '.';
    workspace.pipeline.sync.passed = true;
  } else {
    workspace.pipeline.sync.message += '\nPipeline failed with workspace:\n' + workspace;
    workspace.pipeline.sync.passed = false;
  }
}

/**
 * Runs test cases against all workspace entities.
 * @param {Object} workspace
 * @param {Array} tests
 */
async function testWorkspace(workspace, tests) {
  workspace.pipeline.tests = {};
  workspace.pipeline.tests.total = tests.length;
  workspace.pipeline.tests.message = 'Tests: \ntotal: ' + workspace.pipeline.tests.total + '\n';

  workspace.pipeline.tests.runs = [];
  let failed_tests_messages = [];
  tests.forEach((test) => {
    let test_result = test(Object.freeze(Object.assign({}, workspace)));
    workspace.pipeline.tests.runs.push(test_result);

    if (test_result.passed != true) {
      failed_tests_messages.push('- ' + test_result.name + '\n' + test_result.info + '\n');
    }
  });

  workspace.pipeline.tests.passed = failed_tests_messages.length == 0;
  workspace.pipeline.tests.message +=
    'failed: ' + failed_tests_messages.length + '\n' + failed_tests_messages.join('\n');
}

/**
 * Creates a container version from the entities present in the workspace, deletes the workspace, and sets the base container version to the newly created version.
 * @param {tagmanager_v2.Tagmanager} tagmanager
 * @param {*} workspace
 * @returns
 */
async function createVersion(tagmanager, workspace) {
  if (workspace.pipeline.command.name != 'publish' || workspace.pipeline.tests?.passed != true) {
    return false;
  }

  const workspaceVersion = (
    await tagmanager.accounts.containers.workspaces.create_version({
      path: workspace.path,
      requestBody: {
        name: workspace.pipeline.versionName,
        notes: workspace.description,
      },
    })
  ).data;

  workspace = Object.assign(workspace, workspaceVersion);

  workspace.pipeline.containerVersion = {};
  workspace.pipeline.containerVersion.message = 'Create version: ';
  if (workspace.syncStatus?.mergeConflict) {
    workspace.pipeline.containerVersion.passed = false;
    workspace.pipeline.containerVersion.message +=
      workspace.pipeline.containerVersion.passed + '. Merge conflicts found.';
  } else if (workspace.syncStatus?.syncError) {
    workspace.pipeline.containerVersion.passed = false;
    workspace.pipeline.containerVersion.message +=
      workspace.pipeline.containerVersion.passed + '. Error while syncing.';
  } else if (workspace.compilerError) {
    workspace.pipeline.containerVersion.passed = false;
    workspace.pipeline.containerVersion.message +=
      workspace.pipeline.containerVersion.passed + '. Compiler errors found.';
  } else if (typeof workspace.compilerError == 'undefined' && typeof workspace.syncStatus == 'undefined') {
    workspace.pipeline.containerVersion.passed = true;
    workspace.pipeline.containerVersion.message += workspace.pipeline.containerVersion.passed + '.';
  } else {
    workspace.pipeline.containerVersion.message += '\nPipeline failed with workspace:\n' + workspace;
    workspace.pipeline.containerVersion.passed = false;
  }
}

/**
 * Publishes a container version.
 * @param {tagmanager_v2.Tagmanager} tagmanager
 * @param {Object} workspace
 */
async function publishVersion(tagmanager, workspace) {
  if (workspace.pipeline.command.name != 'publish' || workspace.pipeline.containerVersion?.passed != true) {
    return false;
  }

  const versionPublished = (
    await tagmanager.accounts.containers.versions.publish({
      path: workspace.containerVersion.path,
    })
  ).data;

  workspace = Object.assign(workspace, versionPublished);

  workspace.pipeline.publish = {};
  workspace.pipeline.publish.message = 'Publishing: ';
  if (workspace.compilerError) {
    workspace.pipeline.publish.passed = false;
    workspace.pipeline.publish.message += workspace.pipeline.publish.passed + '. Compiler errors found.';
  } else if (typeof workspace.compilerError == 'undefined') {
    workspace.pipeline.publish.passed = true;
    workspace.pipeline.publish.message += workspace.pipeline.publish.passed + '.';
  } else {
    workspace.pipeline.publish.message += '\nPipeline failed with workspace:\n' + workspace;
    workspace.pipeline.publish.passed = false;
  }
}

/**
 * Constructs Slack message and sends it.
 * @param {Object} workspace
 */
async function sendSlackNotification(workspace) {
  const webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK_URL);

  assignSlackChannel(workspace);

  const message = [
    workspace.pipeline.channel?.message,
    workspace.pipeline.command.message,
    workspace.pipeline.sync?.message,
    workspace.pipeline.tests?.message,
    workspace.pipeline.containerVersion?.message,
    workspace.pipeline.publish?.message,
  ].join('\n');

  // Formatting guide: https://api.slack.com/messaging/composing#message_structure
  await webhook.send({
    text: message,
    channel: workspace.pipeline.channel.name,
  });
}

/**
 * Marks workspace as processed.
 *
 * @param {*} tagmanager
 * @param {*} workspace
 */
async function markProcessedWorkspace(tagmanager, workspace) {
  if (workspace.pipeline.publish?.passed == true) {
    return false;
  }

  await tagmanager.accounts.containers.workspaces.update({
    path: workspace.path,
    requestBody: {
      name: workspace.name + '✓',
      description: workspace.description
    },
  });
}

async function main() {
  const tagmanager = await buildTagManager('../credentials.json');

  let workspaces = await scanWorkspaces(tagmanager, commandsRegex, account.accountId, container.containerId);

  await Promise.all(
    workspaces.map(async (workspace) => {
      await syncWorkspace(tagmanager, workspace);

      buildCommandMessage(workspace);

      await testWorkspace(workspace, tests.test_cases);

      await createVersion(tagmanager, workspace);
      await publishVersion(tagmanager, workspace);

      workspace.pipeline.endTime = new Date().getTime();

      await sendSlackNotification(workspace);

      await markProcessedWorkspace(tagmanager, workspace);
    })
  );
}

main().catch((e) => {
  console.error(e);
  throw e;
});
