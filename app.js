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

var trelloKey = process.env.TRELLO_KEY,
    trelloToken = process.env.TRELLO_TOKEN,
    trelloUrlBase = process.env.TRELLO_URL_BASE || 'gh-jira-connector.herokuapp.com/';

var slackToken = process.env.SLACK_TOKEN;

var request = require('request');
var http = require('http');
var fs = require('fs');
var createRQHandler = require('./rq');
var querystring = require('querystring');
var createHandler = require('github-webhook-handler');
var githubPullRequestHandler = createHandler({ path: '/gh-pr-update', secret: ghSecret });
var jiraWebhookHandler = createRQHandler({ path: '/issue' });
var _ = require('underscore');

var githubJiraLabels = [
    'Completed',
    'Merged to Production',
    'Stakeholder Review',
    'Merge to Staging',
    'PM Review',
    'In Development',
];

http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (url === '/gh-pr-update') {
        githubPullRequestHandler(req, res, function (err) {
            res.statusCode = 404;
            res.end('no such location');
        });
    } else if (url === '/trello-move') {
        req.on('data', function (data) {
            var actualData = JSON.parse(data.toString());
            console.log('TRELLO card moved', actualData.action.data.card.id, actualData.action.data.listAfter);
            console.log(actualData);
            console.log(actualData.action);
            if (actualData.action.display.translationKey === 'action_move_card_from_list_to_list' &&
                actualData.model.id === actualData.action.data.listAfter.id) {
                getCardAttachments(actualData.action.data.card.id, function (error, response, body) {
                    var attachments = response.toJSON().body;
                    var pullRequestUrl = '';
                    if (attachments) {
                        _.each(attachments, function (attachment) {
                            if (attachment.url.indexOf('https://github.com/TopOPPS/topopps-web/pull/') > -1) {
                                //update pull request with label reflective of whatever move is being made
                                // console.log(attachment);
                                var pullRequestNumber = attachment.url.split('https://github.com/TopOPPS/topopps-web/pull/')[1];
                                updateLabels(pullRequestNumber, [actualData.action.data.listAfter.name]);
                            }
                        });
                    }
                });
            }
        });
        res.writeHeader(200, {'Content-Type': 'application/json'});
        res.end();
    } else if (url === '/create-pr') {
        if (req.method == 'POST') {
            var jsonString = '';
            req.on('data', function (data) {
                var actualData = querystring.parse(data.toString());
                if (actualData.token !== slackToken) {
                    res.writeHeader(401, {'Content-Type': 'application/json'});
                    res.end();
                }
                createPullRequest(actualData.text, function (prUrl) {
                    if (typeof prUrl === typeof {}) {
                        res.writeHeader(422, {'Content-Type': 'application/json'});
                        res.write(JSON.stringify({
                            'text': 'Error creating PR'
                        }));
                        res.end();
                        return;
                    }
                    console.log('here in callback', prUrl);
                    res.writeHeader(200, {'Content-Type': 'application/json'});
                    res.write(JSON.stringify({
                        'text': 'Pull Request created! ' + prUrl
                    }));
                    res.end();
                });
            });
        }
        //wut this is spam
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
        var matches = data.payload.pull_request.title.match(/\-\-/g);
        if (matches !== null) {
            var id = data.payload.pull_request.title.split('--')[0].trim();
            if (data.payload.pull_request.comments === 0) {
                console.log('Trello card', id, 'getting PR', data.payload.pull_request.number, 'attached');
                addCardAttachment(id, data.payload.pull_request.html_url);
                addPullRequestComment(id, data.payload.pull_request.number, 'https://trello.com/c/' + id);
                getCard(id , function (error, response, body) {
                    //find list that card is in
                    getList(body.idList, function (er, res, bdy) {
                        //update pull request to reflect card's current column's label
                        updateLabels(data.payload.pull_request.number, [bdy.name]);
                    });
                });
            } else {
                //there are comments, should we read them and check for ours?
            }
        }
    }
});

jiraWebhookHandler.on('jira-issue', function (data) {
    console.log('webhook caught from JIRA for issue', data.data.issue.key);
    var labelsToAdd = [];
    if (data.data.changelog) {
        _.each(data.data.changelog.items, function (change) {
            if (change.field === 'status') {
                labelsToAdd.push(change.toString);
                if (change.fromString === 'Merge to Production' && change.toString === 'Completed') {
                    console.log('Updating Resolution for JIRA issue', data.data.issue.key);
                    updateIssue(data.data.issue.key, 'Done', 'resolution');
                }
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

var addPullRequestComment = function (issueId, prNumber, message) {
    //comment JIRA issue url on pr
    var commentOptions = {
        method: 'POST',
        url: 'https://api.github.com/repos/TopOPPS/topopps-web/issues/' + prNumber + '/comments',
        headers: {
            'Authorization': 'Basic ' + new Buffer(ghUser + ':' + ghAuthToken).toString('base64'),
            'user-agent': 'node.js'
        },
        json: true,
        body: {
            body: message
        }
    };
    request(commentOptions, function (error, response, body) {
        if (!error && response.statusCode == 201) {
            console.log('Comment left on Pull Request for TRELLO issue', issueId);
        } else {
            console.log(response.statusCode, body);
        }
    });
};
var addCardAttachment = function (id, pullRequestUrl, cb) {
    var options = {
        method: 'POST',
        url: 'https://api.trello.com/1/cards/' + id + '/attachments?key=' + trelloKey + '&token=' + trelloToken + '&url=' + pullRequestUrl,
        json: true
    };
    cb = cb || function () {};
    request(options, cb);
};
var getCardAttachments = function (id, cb) {
    var options = {
        method: 'GET',
        url: 'https://api.trello.com/1/cards/' + id + '/attachments?key=' + trelloKey + '&token=' + trelloToken,
        headers: {
            'user-agent': 'node.js'
        },
        json: true
    };
    cb = cb || function () {};
    return request(options, cb);
};
var getCard = function (id, cb) {
    var options = {
        method: 'GET',
        url: 'https://api.trello.com/1/cards/' + id + '?key=' + trelloKey + '&token=' + trelloToken,
        headers: {
            'user-agent': 'node.js'
        },
        json: true
    };
    cb = cb || function () {};
    return request(options, cb);
};
var getList = function (id, cb) {
    var options = {
        method: 'GET',
        url: 'https://api.trello.com/1/list/' + id + '?key=' + trelloKey + '&token=' + trelloToken,
        headers: {
            'user-agent': 'node.js'
        },
        json: true
    };
    cb = cb || function () {};
    return request(options, cb);
};
var getWebhooks = function (update) {
    var options = {
        method: 'GET',
        url: 'https://api.trello.com/1/members/me/tokens?webhooks=true&key=' + trelloKey + '&token=' + trelloToken,
        headers: {
            'user-agent': 'node.js',
            'Content-Type': 'application/json;charset=UTF-8'
        },
        json: true,
    };
    request(options, function (error, response, body) {
        var hooks = response.toJSON().body[0].webhooks;
        console.log(response.statusCode, 'GOT Trello Webhooks', hooks);

        if (hooks.length && update) {
            _.each(hooks, function (hook) {
                    var putOptions = {
                        method: 'PUT',
                        url: 'https://api.trello.com/1/webhooks/?active=true&idModel=' + hook.idModel + '&id=' + hook.id + '&callbackURL=' + trelloUrlBase + 'trello-move&key=' + trelloKey + '&token=' + trelloToken,
                        headers: {
                            'user-agent': 'node.js',
                            'Content-Type': 'application/json;charset=UTF-8'
                        },
                    };
                    request(putOptions, function (err, res, bdy) {
                        console.log(res.statusCode, 'UPDATED Trello Webhook for ', hook.description, hook.id, 'callbackURL to:', trelloUrlBase);
                    });
            });
        }
    });
    //https://api.trello.com/1/members/id/tokens
};

var createPullRequest = function (feature, cb) {
    var prOptions = {
        method: 'POST',
        url: 'https://api.github.com/repos/TopOPPS/topopps-web/pulls',
        headers: {
            'Authorization': 'Basic ' + new Buffer(ghUser + ':' + ghAuthToken).toString('base64'),
            'user-agent': 'node.js',
            'Content-Type': 'application/json;charset=UTF-8'
        },
        json: true,
        body: {
            "base": 'devprod',
            "body": 'Feature going to devprod',
            "title": 'Merging feature ' + feature + ' in to devprod',
            "head": feature
        }
    };

    request(prOptions, function (error, response, body) {
        console.log(response.statusCode);
        if (response.statusCode > 400) {
            //response.toJSON().body.errors;
            cb(response.toJSON().body);
        }
        if (!error && response.statusCode == 201) {
            console.log('success');
            // console.log('Comment left on Pull Request', data.payload.pull_request.number, 'for JIRA issue', issueId);
            cb(body.html_url);
        } else {
            console.log(response.statusCode, body);
        }
    });
};

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
        if (!error && response.statusCode == 200) {
            //remove any jira labels from existing pull request labels
            var labels = JSON.parse(body);
            labels = _.difference(_.pluck(labels, 'name'), githubJiraLabels);
            console.log('PR', prNumber, 'has these labels:', labels);
            setLabelsOptions.body = labels.concat(labelsToAdd);
            setLabelsOptions.json = true;

            console.log('PR', prNumber, 'getting these labels:', setLabelsOptions.body);
            request(setLabelsOptions, function (err, res, bod) {
                if (!err && res.statusCode == 200) {
                    console.log('PR', prNumber, 'Set Labels SUCCESS', setLabelsOptions.body);
                    addPullRequestComment('', prNumber, 'GOT these labels: ' + JSON.stringify(setLabelsOptions.body));
                } else {
                    console.log('PR', prNumber, 'Set Labels ERROR', err, body);
                }
            });
        }
    });
};
getWebhooks(1);
console.log(trelloUrlBase);
console.log('App initialized');
