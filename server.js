// Lockee
// Copyright (C) 2015  Hylke Bons
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.


// Configuration
var package_config = require('./package.json');
var config         = require('./config.json');
var covers         = require('./covers.json');


// Packages
if (config.server.ssl.enabled)
    var https = require('https');

var http        = require('http');
var compression = require('compression');
var fs          = require('fs');
var sqlite3     = require('sqlite3').verbose();
var crypto      = require('crypto');
var async       = require('async');
var express     = require('express');
var helmet      = require('helmet');
var sass        = require('node-sass');
var schedule    = require('node-schedule');

// Express
var app     = express();
app.set('view engine', 'jade');


// Require HTTPS
app.use(function(req, res, next) {
    if (config.server.ssl.enabled && !req.secure) {
        if (config.server.production)
            return res.redirect('https://' + req.host + req.url);
        else
            return res.redirect('https://' + req.hostname + ':' + config.server.ssl.port + req.url);
    }

    next();
});


// Helmet
app.use(helmet.csp({
    defaultSrc: ["'self'"],
    objectSrc:  ["'none'"],
    mediaSrc:   ["'none'"],
    frameSrc:   ["'none'"]
}));

if (config.server.ssl.enabled) {
    app.use(helmet.hsts({
      maxAge: 7776000000,
      includeSubdomains: true
    }));
}

app.use(helmet.xssFilter());
app.use(helmet.frameguard('deny'));
app.use(helmet.hidePoweredBy());
app.use(helmet.crossdomain());


// Rate limiter
var connections = {};
var blockedConnections = {};

var maxConnectionsPerSecond = 10;
var unblockAfter = 10 * 60 * 1000;

// TODO: Limit number of lockers per IP
var rateLimiter = function(req) {
    var now = new Date();

    if (blockedConnections[req.connection.remoteAddress] !== undefined) {
        if ((now - blockedConnections[req.connection.remoteAddress]) > unblockAfter) {
            delete blockedConnections[req.connection.remoteAddress];

        } else {
            blockedConnections[req.connection.remoteAddress] = now;
            return true;
        }
    }

    if (connections[req.connection.remoteAddress] !== undefined) {
        if ((now - connections[req.connection.remoteAddress]) < (1000 / maxConnectionsPerSecond)) {
            blockedConnections[req.connection.remoteAddress] = now;
            return true;
        }
    }

    connections[req.connection.remoteAddress] = now;
};


// Static files
var static = express.static('./public');
app.use(compression()); 
app.use(static);


// Size limiter
var bodyParser = require('body-parser')
app.use(bodyParser.json({ limit: config.locker.size_limit }))


// Database
var db = new sqlite3.Database(config.locker.database);

db.run('CREATE TABLE IF NOT EXISTS lockers (\
            timestamp TIMESTAMP DEFAULT (strftime(\'%s\', \'now\')), \
            path_digest TEXT PRIMARY KEY, \
            passphrase_digest TEXT, \
            salt TEXT, \
            encrypted_file_name TEXT)');

fs.mkdir(config.locker.location, function(err) {
   if (err && err.code != 'EEXIST')
       throw err;

    fs.chmodSync(config.locker.location, 0700);
});


// Sass
sass.render({ file: './public/stylesheets/default.sass' }, function(err, result) {
    fs.writeFile('./public/stylesheets/default.css', result.css, function(err) {            
        if(err) return console.log(err);
    });
});


// Routes
app.get('/', function(req, res) {
    if (rateLimiter(req))
        return res.status(429).json({}); // Too many connections

    res.render('page', {
        domain:             config.server.domain,
        app_name:           package_config.name,
        description:        package_config.description,
        admin_name:         config.server.admin.name,
        admin_contact_info: config.server.admin.contact_info,
        repo_url:           package_config.repository.url,
        page_title:         package_config.name + ' — ' + package_config.description,
        cover_file_name:    config.locker.covers + covers[0].file_name,
        cover_author:       covers[0].author,
        cover_link:         covers[0].link
    });
})

app.get('/*', function(req, res) {
    if (rateLimiter(req))
        return res.status(429).json({}); // Too many connections

    var pathDigest     = digestForPath(req.url);
    var expiresInSeconds = 0;
    
    var sql = db.prepare('SELECT timestamp, salt FROM lockers WHERE path_digest = ? LIMIT 1');

    sql.get(pathDigest, function(err, row) {
        if (err) return console.log(err);
        
        if (row !== undefined) {
            var salt = row.salt;
            expiresInSeconds = calcExpiresInSeconds(row.timestamp);
        }
           
        if (expiresInSeconds < 0) {
            var sql = db.prepare('DELETE FROM lockers WHERE path_digest = ?');

            sql.run(pathDigest, function() {
                fs.unlink(config.locker.location + pathDigest, function(err) {
                    if(err) return console.log(err);
                })
            });
        }
        
        var pageTitle  = '‘' + decodeURI(req.url.substr(1)) + '’ — ' + package_config.name;

        async.series([
            function(callback) {
                if (salt === undefined) {
                    crypto.randomBytes(512, function(err, buffer) {
                        if (err) throw err;
                        
                        salt = crypto.createHash('sha512')
                            .update(buffer).digest('hex');

                        callback();
                    });

                } else {
                    callback();
                }
            },
            function(callback) {
                var cover = getCover(salt);

                res.render('locker', {
                    domain:             config.server.domain,
                    app_name:           package_config.name,
                    description:        package_config.description,
                    admin_name:         config.server.admin.name,
                    admin_contact_info: config.server.admin.contact_info,
                    repo_url:           package_config.repository.url,
                    page_title:         pageTitle,
                    expires_in_seconds: expiresInSeconds,
                    salt:               salt,
                    cover_file_name:    config.locker.covers + cover.file_name,
                    cover_author:       cover.author,
                    cover_link:         cover.link
                });

                callback();
            }
        ], function(err) {
            if (err) return console.log(err);
        });
    });
});

app.post('/*', function(req, res) {
    if (rateLimiter(req))
        return res.status(429).json({}); // Too many connections

    var pathDigest = digestForPath(req.url);
    
    if (req.body.auth_info !== undefined) {
        var authInfo = req.body.auth_info

        if (typeof authInfo.passphrase_digest !== 'string')
            return res.status(400).json({}); // Bad Request

        var sql = db.prepare ('SELECT encrypted_file_name, timestamp FROM lockers \
                               WHERE path_digest = ? AND passphrase_digest = ? LIMIT 1');

        sql.get(pathDigest, authInfo.passphrase_digest, function(err, row) {
            if (err) {
                res.status(500).json({}); // Internal Error
                return console.log(err);
            }
            
            if (row === undefined)
                return res.status(401).json({}); // Unauthorized

            var expiresInSeconds = calcExpiresInSeconds(row.timestamp);

            if (expiresInSeconds < 0)
                return res.status(410).json({}); // Gone

            fs.readFile(config.locker.location + pathDigest, 'utf8', function(err, encryptedFileContent) {
                if (err) {
                    res.status(500).json({}); // Internal Error
                    return console.log(err);
                }

                res.status(200).json({
                    locker: {
                        encrypted_file: {
                            name:       row.encrypted_file_name,
                            content:    encryptedFileContent,
                            expires_in: expiresInSeconds
                        }
                    }
                });
            });        
        });

    } else if (req.body.locker !== undefined) {
        var locker = req.body.locker;

        if (typeof locker.encrypted_file.name         !== 'string' ||
            typeof locker.encrypted_file.content      !== 'string' ||
            typeof locker.auth_info.passphrase_digest !== 'string' ||
            typeof locker.auth_info.salt              !== 'string') {

            return res.status(400).json({}); // Bad request
        }

        if (!locker.auth_info.passphrase_digest.match('^[a-f0-9]+$') ||
            !locker.auth_info.salt.match('^[a-f0-9]+$') ||
            !locker.encrypted_file.content.match('^[0-9a-zA-Z\+/=]+$') ||
            !locker.encrypted_file.name.match('^[0-9a-zA-Z\+/=]+$')) {

            return res.status(400).json({}); // Bad request
        }

        var sql = db.prepare('INSERT INTO lockers \
            (path_digest, passphrase_digest, salt, encrypted_file_name) VALUES (?, ?, ?, ?)');    

        sql.run(pathDigest, locker.auth_info.passphrase_digest,
                locker.auth_info.salt, locker.encrypted_file.name, function(err) {

            if (err) {
                res.status(400).json({}); // Bad request
                return console.log(err);
            }

            var fileOptions = {
                encoding: 'utf8',
                mode:     0600
            };

            // TODO: Divide into subdirectories
            fs.writeFile(config.locker.location + pathDigest, locker.encrypted_file.content, fileOptions, function(err) {
                if(err) {
                    res.status(500).json({}); // Internal Error
                    return console.log(err);
                }

                res.status(201).json({}); // Created
            });        
        });

    } else {
        return res.status(400).json({}); // Bad Request
    }
});


// Scheduled tasks
function removeExpiredBlobs() {
    var timeLimit = Math.floor(new Date() / 1000) - config.locker.time_limit;

    db.each('SELECT timestamp, path_digest FROM lockers', function(err, row) {
        if (row.timestamp < timeLimit) {
            var sql = db.prepare ('DELETE FROM lockers WHERE path_digest = ?');

            sql.run (row.path_digest, function() {
                fs.unlink(config.locker.location + row.path_digest, function(err) {
                    if(err) return console.log(err);
                })
            });
        }
    });
}

schedule.scheduleJob('0,15,30,45 * * * *', function() {
    console.log('Running scheduled task: removeExpiredBlobs()');
    removeExpiredBlobs();
});


// Helpers
function digestForPath(path) {
    var salt = crypto.createHash('sha256')
        .update(package_config.name)
        .digest('hex');
    
    return crypto.createHash('sha256')
        .update(salt)
        .update(path)
        .digest('hex');
}

function calcExpiresInSeconds(timestamp) {
    return timestamp + config.locker.time_limit - Math.floor(new Date() / 1000);   
}

function getCover(hash) {
    var number = 0;

    for (i = 0; i < hash.length; i++)
        number += hash.charCodeAt(i);

    return covers[number % covers.length];
}


// Server
var port = process.env.OPENSHIFT_NODEJS_PORT || config.server.port
var ip   = process.env.OPENSHIFT_NODEJS_IP   || '127.0.0.1'

if (config.server.ssl.enabled) {
    var credentials = {
        key:  fs.readFileSync(config.server.ssl.privateKey,  'utf8'),
        cert: fs.readFileSync(config.server.ssl.certificate, 'utf8')
    };

    ip = process.env.OPENSHIFT_NODEJS_PORT || config.server.ssl.port

    var secure_server = https.createServer(credentials, app);
    secure_server.listen(config.server.ssl.port, ip);
}

var server = http.createServer(app);
server.listen(port, ip);
