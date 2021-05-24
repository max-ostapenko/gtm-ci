// We need put as a separate repo

'use strict';

import * as Msal from 'msal'; // Docs: https://docs.microsoft.com/en-us/azure/active-directory/develop/reference-v2-libraries

const msalConfig = {
  auth: {
    clientId: 'your_client_id',
  },
};

const msalInstance = new Msal.UserAgentApplication(msalConfig);

msalInstance.handleRedirectCallback((error, response) => {
  // handle redirect response or error
});

// Auth flow: https://docs.microsoft.com/en-us/graph/auth-v2-service
// Sample code: https://azuread.github.io/microsoft-authentication-library-for-js/ref/msal-core/

// Request to for permissions: GET https://graph.microsoft.com/v1.0/me/drive/items/01IZCRRXEJIUMHXH5FPJF3XHV43ZQZULA5/workbook/tables/Table1/rows
