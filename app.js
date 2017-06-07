/*
  TOPOPPS' internal Jira / Github integration.

  jira webhooks:
  /issue - triggers on ISSUE create, update, delete

  github webhooks:
  /gh-pr-update - triggers on PULL REQUEST create, update, delete
*/
if (process.env.IS_LOCAL == 1) {
    require('dotenv').config();
}
var ghAuthToken = process.env.GH_TOKEN,
    ghUser = process.env.GH_USER,
    ghSecret = process.env.GH_SECRET;

var jiraUser = process.env.JIRA_USER,
    jiraPassword = process.env.JIRA_PASSWORD;

var request = require('request');
var http = require('http');
var fs = require('fs');
var createRQHandler = require('./rq');
var createHandler = require('github-webhook-handler');
var githubPullRequestHandler = createHandler({ path: '/gh-pr-update', secret: ghSecret });
var jiraWebhookHandler = createRQHandler({ path: '/issue' });
var _ = require('underscore');

var githubJiraLabels = [
    'Completed',
    'Merge to Production',
    'Project Manager Review',
    'Stakeholder Review',
    'Merge to Staging',
    'Demo',
    'Merge To Dev',
    'Pending Assignment',
    'In_Development'
];

http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (url === '/gh-pr-update') {
        githubPullRequestHandler(req, res, function (err) {
            res.statusCode = 404;
            res.end('no such location');
        });
    } else if (url === '/issue') {
        jiraWebhookHandler(req, res, function (err) {
            res.statusCode = 404;
            res.end('no such location');
        });
    } else {
        var html = fs.readFileSync('./some.html');
        res.writeHeader(200, {"Content-Type": "text/html"});
        res.write(html);
        res.end();
        //wut this is spam
    }
}).listen(process.env.PORT || 8081);

githubPullRequestHandler.on('pull_request', function (data) {
    if (data.payload) {
        console.log('webhook caught from github for Pull Request: ', data.payload.pull_request.html_url);
        var matches = data.payload.pull_request.title.match(/TOP\-\d{1,}/g);
        if (matches !== null) {
            _.each(matches, function (match) {
                if (data.payload.pull_request.comments === 0) {
                    //make call to pr and add comment,

                    //make sure pr link is on JIRA issue
                    updateIssue(match, data.payload.pull_request.html_url);

                    //comment JIRA issue url on pr
                    var commentOptions = {
                        method: 'POST',
                        url: 'https://api.github.com/repos/TopOPPS/topopps-web/issues/' + data.payload.pull_request.number + '/comments',
                        headers: {
                            'Authorization': 'Basic ' + new Buffer(ghUser + ':' + ghAuthToken).toString('base64'),
                            'user-agent': 'node.js'
                        },
                        json: true,
                        body: {
                            body: 'https://topopps.atlassian.net/browse/' + match
                        }
                    };
                    request(commentOptions, function (error, response, body) {
                        if (!error && response.statusCode == 204) {
                            console.log('Comment left on Pull Request', data.payload.pull_request.number, 'for JIRA issue', match);
                        } else {
                            console.log(response.statusCode, body);
                        }
                    });

                    //get issue from JIRA, ensure JIRA issue initial status set on pr label
                    getIssue(match, function (payload) {
                        if (payload.fields.status.name) {
                            updateLabels(data.payload.pull_request.number, [payload.fields.status.name]);
                        }
                    });
                } else {
                    //there are comments, should we read them and check for ours?

                }
            });
        }
    }
});

jiraWebhookHandler.on('jira-issue', function (data) {
    console.log(data.data.issue.fields, _.keys(data.data.issue.fields))
    console.log('webhook caught from JIRA for issue', data.data.issue.fields.id);
    var labelsToAdd = [];
    if (data.data.changelog) {
        _.each(data.data.changelog.items, function (change) {
            if (change.field === 'status') {
                labelsToAdd.push(change.toString);
                // if (change.fromString === 'Merge To Dev' && change.toString === 'Project Manager Review') {
                //     labelsToAdd.push('On Dev');
                //     //make call to pull request to set dev label on it
                // } else if (change.fromString === 'Merge to Staging' && change.toString === 'Stakeholder Review') {
                //     labelsToAdd.push('On Staging');
                //     //make call to pull request to set staging label on it
                // } else if (change.fromString === 'Merge to Production' && change.toString === 'Completed') {
                //     //prod case
                // }
            }
        });
    }

    var pr = data.data.issue.fields.customfield_10201;
    if (pr && labelsToAdd) {
        updateLabels(pr.split('/pull/')[1], labelsToAdd);
    }
});


var updateLabels = function (prNumber, labelsToAdd) {
    if (labelsToAdd.length === 0) {
        return;
    }
    var getLabelsOptions = {
        method: 'GET',
        url: 'https://api.github.com/repos/TopOPPS/topopps-web/issues/' + prNumber + '/labels',
        headers: {
            'Authorization': 'Basic ' + new Buffer(ghUser + ':' + ghAuthToken).toString('base64'),
            'user-agent': 'node.js'
        }
    };
    var setLabelsOptions = _.extend({}, getLabelsOptions);
    setLabelsOptions.method = 'PUT';
    request(getLabelsOptions, function (error, response, body) {
        console.log('PR', prNumber, 'has these labels:', body);
        if (!error && response.statusCode == 200) {
            //remove any jira labels from existing pull request labels
            var labels = JSON.parse(body);
            labels = _.difference(_.pluck(labels, 'name'), githubJiraLabels);
            setLabelsOptions.body = labels.concat(labelsToAdd);
            setLabelsOptions.json = true;

            console.log('PR', prNumber, 'getting these labels:', setLabelsOptions.body);
            request(setLabelsOptions, function (err, res, bod) {
                if (!err && res.statusCode == 200) {
                    console.log('PR', prNumber, 'Set Labels SUCCESS', setLabelsOptions.body);
                } else {
                    console.log('PR', prNumber, 'Set Labels ERROR', err, body);
                }
            });
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
            'Authorization': 'Basic ' + new Buffer(jiraUser + ':' + jiraPassword).toString('base64'),
            'Content-Type': 'application/json'
        },
        body: {
            fields: {
                customfield_10201: value
            }
        }
    };
    request(options, function (error, response, body) {
        if (!error && response.statusCode == 204) {
            console.log('there', body, body.changelog.items[0].field);
        } else {
            console.log(response.statusCode, body);
        }
    });
};
var getIssue = function (issueNumber, callback) {
    var options = {
        method: 'GET',
        json: true,
        url: 'https://topopps.atlassian.net/rest/api/2/issue/' + issueNumber,
        headers: {
            'Authorization': 'Basic ' + new Buffer(jiraUser + ':' + jiraPassword).toString('base64'),
            'Content-Type': 'application/json'
        }
    };
    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            if (typeof callback === 'function') {
                callback(body);
            }
        } else {
            console.log(response.statusCode, body);
        }
    });
};
console.log('App initialized');
