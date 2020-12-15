'use strict';

const request = require('request');
const config = require('./config/config');
const async = require('async');
const fs = require('fs');

let Logger;
let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 10;

function startup(logger) {
  let defaults = {};
  Logger = logger;

  const { cert, key, passphrase, ca, proxy, rejectUnauthorized } = config.request;

  if (typeof cert === 'string' && cert.length > 0) {
    defaults.cert = fs.readFileSync(cert);
  }

  if (typeof key === 'string' && key.length > 0) {
    defaults.key = fs.readFileSync(key);
  }

  if (typeof passphrase === 'string' && passphrase.length > 0) {
    defaults.passphrase = passphrase;
  }

  if (typeof ca === 'string' && ca.length > 0) {
    defaults.ca = fs.readFileSync(ca);
  }

  if (typeof proxy === 'string' && proxy.length > 0) {
    defaults.proxy = proxy;
  }

  if (typeof rejectUnauthorized === 'boolean') {
    defaults.rejectUnauthorized = rejectUnauthorized;
  }

  requestWithDefaults = request.defaults(defaults);
}

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.debug(entities);
  entities.forEach((entity) => {
    const url = `https://www.googleapis.com/`;

    let requestOptions = {
      method: 'GET',
      uri: `${url}customsearch/v1/`,
      qs: {
        key: options.apiKey,
        cx: options.cx,
        num: options.maxResults,
        q: `"${entity.value}"`
      },
      json: true
    };

    Logger.trace({ requestOptions }, 'Request Options');

    tasks.push(function(done) {
      requestWithDefaults(requestOptions, function(error, res, body) {
        Logger.trace({ body, status: res.statusCode });
        let processedResult = handleRestError(error, entity, res, body);

        if (processedResult.error) {
          done(processedResult);
          return;
        }

        done(null, processedResult);
      });
    });
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      Logger.error({ err: err }, 'Error');
      cb(err);
      return;
    }

    results.forEach((result) => {
      if (result.body === null || result.body.searchInformation.totalResults === '0') {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: {
            details: result.body
          }
        });
      }
    });

    Logger.debug({ lookupResults }, 'Results');
    cb(null, lookupResults);
  });
}

function handleRestError(error, entity, res, body) {
  let result;

  if (error || !body) {
    return {
      error,
      body,
      detail: 'HTTP Request Error'
    };
  }

  if (res.statusCode !== 200) {
    return {
      error: 'Did not receive HTTP 200 Status Code',
      statusCode: res ? res.statusCode : 'Unknown',
      detail: 'An unexpected error occurred',
      body, 
      res
    };
  }

  if (res.statusCode === 200) {
    // we got data!
    result = {
      entity: entity,
      body: body
    };
  } else {
    result = {
      body,
      errorNumber: body.errorNo,
      error: body.errorMsg,
      detail: body.errorMsg
    };
  }

  return result;
}

module.exports = {
  doLookup: doLookup,
  startup: startup
};
