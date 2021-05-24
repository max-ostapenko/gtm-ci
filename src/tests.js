'use strict';
const permissions = require('../config/permissions.json');
const grantees = require('../config/grantees.json');
//TODO replace with logic to get list of usernames excel file

const usernames = Object.keys(grantees);
let test_cases = [];

//Re-usable function to check username in permissions
function checkUsername(currentWorkspace, granteeList) {
  let username;
  granteeList.forEach(
    (entry) => (username = currentWorkspace.name.indexOf(entry) > -1 ? (username = entry) : username)
  );
  return username;
}

//Re-usable function to check Permission Group for the user that triggered the request
function getPermissionGroup(currentUser) {
  let permissionGroup = grantees[currentUser][0];
  return permissionGroup;
}

//Test to check if workspace name contains a username recognized in the database
test_cases.push(function (workspace) {
  //working object to reuse variables between functions if needed. Gets reset on each set of tests per worspace.
  let result = {};
  result.name = 'Username and Permission Group Check';
  let user = checkUsername(workspace, usernames);

  if (user == undefined) {
    result.passed = false;
    result.info = `-- Username in "${workspace.name}" has not been identified in permissions data base. Please double check that the correct username has been used`;
  } else {
    //TODO replace with logic to check against excel file
    let permissionGroup = getPermissionGroup(user);
    if (permissionGroup == undefined) {
      result.passed = false;
      result.info = `-- No permissions associated with user "${user}". Please contact the Analytics Team to resolve this issue`;
    } else {
      result.passed = true;
      result.info = `-- Username "${user}" included in "${permissionGroup}" group policy in permissions database`;
    }
  }
  return result;
});

//Test to check the permissions of the user that placed the command.
test_cases.push(function (workspace) {
  let result = {};
  result.name = 'Permissions Test';

  //If the previous test failed, this will fail by default as a username has not been identified.
  if (checkUsername(workspace, usernames) == undefined) {
    result.passed = false;
    result.info = '-- Test could not be correctly performed as no Username has been identified in the workspace name.';
  } else {
    let user = checkUsername(workspace, usernames);
    let changeAssessment = [];
    let permissionGroup = getPermissionGroup(user);
    let permissionDetails = permissions[permissionGroup];
    //Expected values in each change's object
    let entitiesList = ['tag', 'trigger', 'variable', 'folder', 'zone', 'template'];
    let changeRegex = /(add|update|delete)/g;

    //Bypass tests if users is from the analyticsEngineers permissions group
    if (permissionGroup == 'analyticsEngineers') {
      result.passed = true;
      result.info = `Username "${user}" included in "${permissionGroup}" group policy has enough permissions to perform all the changes in the workspace`;
      return result;
    }

    //Fail test if no changes are identified in the workspace
    if (workspace.workspaceChange == undefined) {
      result.passed = false;
      result.info = `No changes identified in workspace. Please ensure the request has been made for the correct workspace`;
      return result;
    }

    //Information about custom templates is not correctly surfaced using getStatus(). Whenever there is an interaction with a custom template interactions it should done in a separate and dedicated workspace and reviewed manually as it can impact several tags from different parties.
    workspace.workspaceChange.forEach((change) => {
      let changeType = Object.keys(change).filter((key) => entitiesList.indexOf(key) > -1)[0];
      //Check if user has permissions to make the change performed (check if it has enough rights to make change to the entity type +  make change in specific parent folder)
      //If there is no entity type as key in the change object, it is not possible to perform tests. This is the case when changes are made to Custom Templates or Zones.
      if (changeType == undefined) {
        changeAssessment.push(
          `-- A change in your workspace could not be identified and this process will not be able to progress. Ensure there are no interactions with Custom Templates and please contact Analytics Team to resolve this issue if it persists`
        );
      } else {
        let changeAction = change.changeStatus;
        let changeDetail = change[changeType].type;
        let changeName = change[changeType].name;
        let changePath = change[changeType].path;
        let changeParentFolder = change[changeType].parentFolderId;
        if (permissionDetails.entities[changeType].hasOwnProperty(changeDetail) == false) {
          changeAssessment.push(
            `-- No permissions to interact with "${changeDetail}" ${changeType} - <https://tagmanager.google.com/#/container/${changePath}|"${changeName}">`
          );
        } //If user has permissions to interact with this element, check if the user can make this kind of change (add, delete, update)
        else {
          if (permissionDetails.entities[changeType][changeDetail][changeAction] != true) {
            changeAssessment.push(
              `-- No permissions to ${
                changeAction.match(changeRegex)[0]
              } "${changeDetail}" ${changeType} - <https://tagmanager.google.com/#/container/${changePath}|"${changeName}">`
            );
          } //Check if the element changed has a folder associated
          if (changeParentFolder == undefined) {
            changeAssessment.push(
              `-- Please assign a folder to ${
                changeAction.match(changeRegex)[0]
              } "${changeDetail}" ${changeType} - <https://tagmanager.google.com/#/container/${changePath}|"${changeName}">`
            );
          } //If it has a folder associated, check if the user has permissions to change that folder
          else if (permissionDetails.entities['folder'].hasOwnProperty(changeParentFolder) == false) {
            changeAssessment.push(
              `-- No permissions to interact with a ${changeType} in folder ${changeParentFolder} - <https://tagmanager.google.com/#/container/${changePath}|"${changeName}">`
            );
          }
        }
      }
    });
    //If there is 1 issue or more, test result is false and all errors are listed in a readable way in the pipeline message
    if (changeAssessment.length > 0) {
      result.passed = false;
      result.info = changeAssessment.join('\r\n');
    } //Otherwise test is passed
    else {
      result.passed = true;
      result.info = `Username "${user}" included in "${permissionGroup}" group policy has enough permissions to perform all the changes in the workspace`;
    }
  }
  return result;
});

//Template test function. Uncommend and make modifications as needed.
// test_cases.push(function (workspace) {
//   let result = {};
//   result.name = 'HTML tags restrict';

//   result.passed = false;
//   result.info = 'Detailed description.';

//   return result;
// });

exports.test_cases = test_cases;
