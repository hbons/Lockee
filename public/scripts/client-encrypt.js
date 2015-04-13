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


importScripts('/scripts/sjcl.min.js',
              '/scripts/forge.min.js');

self.addEventListener('message', function(event) {
    var url         = event.data[0];
    var passphrase  = event.data[1];
    var salt        = event.data[2];
    var fileName    = event.data[3];
    var fileContent = event.data[4];

    var saltBits  = sjcl.codec.hex.toBits(salt);
    var bitLength = 512

    var pbkdf2Bits   = sjcl.misc.pbkdf2(passphrase, saltBits, 20 * 1000, bitLength);
    var pbkdf2Digest = sjcl.codec.hex.fromBits(pbkdf2Bits);

    var derivedKey       = pbkdf2Digest.substr(0,             bitLength / 8);
    var passphraseDigest = pbkdf2Digest.substr(bitLength / 8, bitLength / 8);

    var iv  = forge.util.hexToBytes(salt);
    var key = forge.pkcs5.pbkdf2(passphraseDigest, salt, 1, (bitLength / 2) / 8);

    // TODO: Chunked encryption and upload
    var closedLocker = JSON.stringify({
        'locker': {
            'auth_info': {
                'passphrase_digest': passphraseDigest,
                'salt':              salt
            },
            'encrypted_file': {
                'name':    '' + encrypt(key, iv, fileName),
                'content': '' + encrypt(key, iv, fileContent)
            }
        }
    });

    fileContent = null;

    var request = new XMLHttpRequest();
    request.open('POST', url);
    request.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');

    request.onreadystatechange = function() {
        if (request.readyState != 4)
            return;

        var err = false;

        if (request.status != 201)
            err = true;

        self.postMessage([err]);
        self.close();
    };

    request.send(closedLocker);
});

function encrypt(key, iv, data) {
    var cipher = forge.cipher.createCipher('AES-CBC', key);
    cipher.start({iv: iv});
    cipher.update(forge.util.createBuffer(data));
    cipher.finish();

    return forge.util.encode64(cipher.output.data);
}
