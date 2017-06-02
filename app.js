var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var github = require('./github')
/*
  TOPOPPS' internal Jira / Github integration.

  jira webhooks:
  /issue - triggers on ISSUE create, update, delete

*/


app.use( bodyParser.json() )

app.post('/issue',  function(req, res){

  var rawData = req.body.issue
  var action = req.body.issue_event_type_name
  var issueData = {
    "issueId": rawData.key,
    "pullRequest": rawData.fields.customfield_10201,
    "status": rawData.fields.status.name
  }

  github.repeat(issueData);

  res.end("Success!")
});

var server = app.listen(8081)
