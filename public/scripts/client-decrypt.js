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
              '/scripts/cryptojs.aes.min.js');

self.addEventListener('message', function(event) {
    var url        = event.data[0];
    var passphrase = event.data[1];
    var salt       = event.data[2];

    var saltBits  = sjcl.codec.hex.toBits(salt);
    var bitLength = 512

    var pbkdf2Bits   = sjcl.misc.pbkdf2(passphrase, saltBits, 100 * 1000, bitLength);
    var pbkdf2Digest = sjcl.codec.hex.fromBits(pbkdf2Bits);

    var derivedKey       = pbkdf2Digest.substr(0,             bitLength / 8);
    var passphraseDigest = pbkdf2Digest.substr(bitLength / 8, bitLength / 8);

    var lockerRequest = JSON.stringify({ 'auth_info': { 'passphrase_digest': passphraseDigest }});
    var request = new XMLHttpRequest();

    request.open('POST', url);
    request.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');

    request.onreadystatechange = function() {
        if (request.readyState != 4)
            return;

        if (request.status == 401) {
            self.postMessage([true, null, null]);
            self.close();

            return;
        }

        if (request.status != 200)
            return;

        var closedLocker = JSON.parse(request.responseText).locker;
        request.responseText = null;

        var aes_key = CryptoJS.enc.Hex.parse(passphrase);
        var aes_iv  = CryptoJS.enc.Hex.parse(salt);

        var fileName    = CryptoJS.AES.decrypt(closedLocker.encrypted_file.name,    derivedKey).toString(CryptoJS.enc.Utf8);
        var fileContent = CryptoJS.AES.decrypt(closedLocker.encrypted_file.content, derivedKey).toString(CryptoJS.enc.Utf8);

        var contentBlob = dataURItoBlob(fileContent);

        self.postMessage([false, fileName, contentBlob]);
        self.close();
    };

    request.send(lockerRequest);
});

function dataURItoBlob(dataURI) {
    // TODO: Safari doesn't support atob() in web workers
    var binary = atob(dataURI.split(',')[1]);
    var array  = [];

    for(var i = 0; i < binary.length; i++)
        array.push(binary.charCodeAt(i));

    return new Blob([new Uint8Array(array)]);
}
