var express = require('express');
var bodyParser = require('body-parser');
// var app = express();
var github = require('./github');
var request = require('request');
var http = require('http');
var createRQHandler = require('./rq');
var createHandler = require('github-webhook-handler')
var githubPullRequestHandler = createHandler({ path: '/gh-pr-update', secret: '' })
var jiraWebhookHandler = createRQHandler({ path: '/issue' });
var _ = require('underscore');

http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (url === '/gh-pr-update') {
        githubPullRequestHandler(req, res, function (err) {
            res.statusCode = 404
            res.end('no such location')
        })
    } else if (url === '/issue') {
        jiraWebhookHandler(req, res, function (err) {
            res.statusCode = 404
            res.end('no such location')
        })
    } else {
        //wut
    }
}).listen(8081);

githubPullRequestHandler.on('pull_request', function (data) {
    if (data.payload) {
        console.log('webhook caught from github for pullRequest: ', data.payload.pull_request.html_url);
        var matches = data.payload.pull_request.title.match(/TOP\-\d{1,}/g);
        if (matches !== null) {
            _.each(matches, function (match) {
                updateIssue(match, data.payload.pull_request.html_url);
            });
        }
    }
});

jiraWebhookHandler.on('jira-issue', function (data) {
    console.log('* caught', arguments);
    _.each(data.data.changelog.items, function (change) {
        debugger;
        if (change.field === 'status') {
            if (change.fromString === 'Merge To Dev' && change.toString === 'Project Manager Review') {
                //make call to pull request to set dev label on it
            } else if (change.fromString === 'Merge to Staging' && change.toString === 'Stakeholder Review') {
                //make call to pull request to set staging label on it
            } else if (change.fromString === 'Merge to Production' && change.toString === 'Completed') {
                //prod case
            }
        }
    });
});

/*
  TOPOPPS' internal Jira / Github integration.

  jira webhooks:
  /issue - triggers on ISSUE create, update, delete

*/

//
// app.use( bodyParser.json() );
//
// app.post('/gh-pr-update',  function (req, res) {
//     console.log(arguments);
// });
// app.post('/issue',  function (req, res) {
//
//     var rawData = req.body.issue;
//     var action = req.body.issue_event_type_name;
//     var issueData = {
//         "issueId": rawData.key,
//         "pullRequest": rawData.fields.customfield_10201,
//         "status": rawData.fields.status.name
//     };
//
//     github.repeat(issueData);
//
//     res.end("Success!");
// });
// const server = app.listen(8081);

var user = '',
    password = '',
    secret = '';

var getIssue = function (issueNumber) {
    var options = {
        type: 'GET',
        url: 'https://topopps.atlassian.net/rest/api/2/issue/' + issueNumber,
        headers: {
            'Authorization': 'Basic ' + new Buffer(user + ':' + password).toString('base64'),
            'Content-Type': 'application/json'
        }
    };
    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            debugger;
            console.log('there', arguments);
        }
    });
};

var updateIssue = function (issueNumber, value) {
    /*
    curl -D- -u fred:fred -X PUT --data {see below} -H "Content-Type: application/json" http://kelpie9:8081/rest/api/2/issue/QA-31

    {
        "fields" : {
            "customfield_10200" :
            {"value" : "Test 1"}
            ,
            "customfield_10201" :
            {"value" : "Value 1"}
        }
    }
    */
    var options = {
        method: 'PUT',
        json: true,
        url: 'https://topopps.atlassian.net/rest/api/2/issue/' + issueNumber,
        headers: {
            'Authorization': 'Basic ' + new Buffer(user + ':' + password).toString('base64'),
            'Content-Type': 'application/json'
        },
        body: {
            fields: {
                customfield_10201: value
            }
        }
    };
    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            console.log('there', arguments);
        }
    });
}
console.log('here');
//
// getIssue('TOP-66');
