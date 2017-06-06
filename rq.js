//rq.js
const EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    crypto = require('crypto'),
    bl = require('bl'),
    bufferEq = require('buffer-equal-constant-time');

function create(options) {
    if (typeof options != 'object')
        throw new TypeError('must provide an options object')
    var events

    if (typeof options.events == 'string' && options.events != '*')
        events = [options.events]

    else if (Array.isArray(options.events) && options.events.indexOf('*') == -1)
        events = options.events

    // make it an EventEmitter, sort of
    handler.__proto__ = EventEmitter.prototype
    EventEmitter.call(handler)

    return handler


    function handler(req, res, callback) {
        if (req.url.split('?').shift() !== options.path || req.method !== 'POST')
            return callback()

        function hasError(msg) {
            res.writeHead(400, {
                'content-type': 'application/json'
            })
            res.end(JSON.stringify({
                error: msg
            }))

            var err = new Error(msg)

            handler.emit('error', err, req)
            callback(err)
        }


        req.pipe(bl(function (err, data) {
            if (err) {
                return hasError(err.message)
            }

            var obj

            try {
                obj = JSON.parse(data.toString())
            } catch (e) {
                return hasError(e)
            }

            res.writeHead(200, {
                'content-type': 'application/json'
            })
            res.end('{"ok":true}')
            var event = 'jira-issue';
            var emitData = {
                event: event,
                protocol: req.protocol,
                host: req.headers['host'],
                url: req.url,
                data: obj
            };
            handler.emit(event, emitData)
            handler.emit('*', emitData)
        }))
    }
}


module.exports = create
