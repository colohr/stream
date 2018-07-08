const crypto = require('crypto')
const fs = require('fs')
const Stream = require('stream')
const path = require('path')
const Content = require('./Content')
const File = require('./File')

class FileRequestEmitter extends require('events'){
	_parseContentType(){
		if(this.bytesExpected === 0){
			this._parser = dummyParser(this);
			return;
		}

		if(!this.headers['content-type']){
			this._error(new Error('bad content-type header, no content-type'));
			return;
		}

		if(this.headers['content-type'].match(/octet-stream/i)){
			this._initOctetStream();
			return;
		}

		if(this.headers['content-type'].match(/urlencoded/i)){
			this._initUrlencoded();
			return;
		}

		if(this.headers['content-type'].match(/multipart/i)){
			var m = this.headers['content-type'].match(/boundary=(?:"([^"]+)"|([^;]+))/i);
			if(m){
				this._initMultipart(m[1] || m[2]);
			}
			else{
				this._error(new Error('bad content-type header, no multipart boundary'));
			}
			return;
		}

		if(this.headers['content-type'].match(/json/i)){
			this._initJSONencoded();
			return;
		}

		this._error(new Error('bad content-type header, unknown content-type: ' + this.headers['content-type']));
	}

	_error(err){
		if(this.error || this.ended) return;

		this.error = err;
		this.emit('error', err);

		if(Array.isArray(this.openedFiles)){
			this.openedFiles.forEach(function(file){
				file._writeStream.destroy();
				setTimeout(fs.unlink, 0, file.path, function(error){ });
			});
		}
	}

	_parseContentLength(){
		this.bytesReceived = 0;
		if(this.headers['content-length']){
			this.bytesExpected = parseInt(this.headers['content-length'], 10);
		}
		else if(this.headers['transfer-encoding'] === undefined){
			this.bytesExpected = 0;
		}

		if(this.bytesExpected !== null){
			this.emit('progress', this.bytesReceived, this.bytesExpected);
		}
	}

	_newParser(){
		return Content.Multipart()
	}

	_initMultipart(boundary){
		this.type = 'multipart';

		var parser = Content.Multipart(),
			self = this,
			headerField,
			headerValue,
			part;

		parser.initWithBoundary(boundary);

		parser.onPartBegin = function on_part_begin(){
			part = new Stream();
			part.readable = true;
			part.headers = {}
			part.name = null;
			part.filename = null;
			part.mime = null;

			part.transferEncoding = 'binary';
			part.transferBuffer = '';

			headerField = '';
			headerValue = '';
		}

		parser.onHeaderField = function on_header_field(b, start, end){
			headerField += b.toString(self.encoding, start, end);
		}

		parser.onHeaderValue = function on_header_value(b, start, end){
			headerValue += b.toString(self.encoding, start, end);
		}

		parser.onHeaderEnd = function on_header_end(){
			headerField = headerField.toLowerCase();
			part.headers[headerField] = headerValue;

			// matches either a quoted-string or a token (RFC 2616 section 19.5.1)
			var m = headerValue.match(/\bname=("([^"]*)"|([^\(\)<>@,;:\\"\/\[\]\?=\{\}\s\t/]+))/i);
			if(headerField == 'content-disposition'){
				if(m){
					part.name = m[2] || m[3] || '';
				}

				part.filename = self._fileName(headerValue);
			}
			else if(headerField == 'content-type'){
				part.mime = headerValue;
			}
			else if(headerField == 'content-transfer-encoding'){
				part.transferEncoding = headerValue.toLowerCase();
			}

			headerField = '';
			headerValue = '';
		}

		parser.onHeadersEnd = function on_headers_end(){
			switch(part.transferEncoding){
				case 'binary':
				case '7bit':
				case '8bit':
					parser.onPartData = function on_part_data(b, start, end){
						part.emit('data', b.slice(start, end))
					}
					parser.onPartEnd = function on_part_end(){
						part.emit('end')
					}
					break
				case 'base64':
					parser.onPartData = function on_part_data(b, start, end){
						part.transferBuffer += b.slice(start, end).toString('ascii');

						/*
						Four bytes (chars) in base64 converts to three bytes in binary
						encoding. So we should always work with a number of bytes that
						can be divided by 4, it will result in a number of bytes that
						can be divided by 3.
						*/
						var offset = parseInt(part.transferBuffer.length / 4, 10) * 4;
						part.emit('data', new Buffer(part.transferBuffer.substring(0, offset), 'base64'));
						part.transferBuffer = part.transferBuffer.substring(offset);
					}

					parser.onPartEnd = function on_part_end(){
						part.emit('data', new Buffer(part.transferBuffer, 'base64'));
						part.emit('end');
					}
					break;

				default:
					return self._error(new Error('unknown transfer-encoding'));
			}

			self.stream(part)
		}

		parser.onEnd = function on_end(){
			self.ended = true;
			self._maybeEnd();
		}

		this._parser = parser;
	}

	_fileName(headerValue){
		// matches either a quoted-string or a token (RFC 2616 section 19.5.1)
		var m = headerValue.match(/\bfilename=("(.*?)"|([^\(\)<>@,;:\\"\/\[\]\?=\{\}\s\t/]+))($|;\s)/i);
		if(!m) return;

		var match = m[2] || m[3] || '';
		var filename = match.substr(match.lastIndexOf('\\') + 1);
		filename = filename.replace(/%22/g, '"');
		filename = filename.replace(/&#([\d]{4});/g, function replace_character_codes(m, code){
			return String.fromCharCode(code);
		});
		return filename;
	}

	_initUrlencoded(){
		this.type = 'urlencoded';

		var parser = Content.Querystring(this.maxFields)
			, self = this;

		parser.onField = function on_field(key, val){
			self.emit('field', key, val);
		}

		parser.onEnd = function on_end(){
			self.ended = true;
			self._maybeEnd();
		}

		this._parser = parser;
	}

	_initOctetStream(){
		this.type = 'octet-stream';
		var filename = this.headers['x-file-name'];
		var mime = this.headers['content-type'];

		var file = new File({
			path: this._uploadPath(filename),
			name: filename,
			type: mime
		});

		this.emit('fileBegin', filename, file);
		file.open();
		this.openedFiles.push(file);
		this._flushing++;

		var self = this;

		self._parser = Content.Octet();

		//Keep track of writes that haven't finished so we don't emit the file before it's done being written
		var outstandingWrites = 0;

		self._parser.on('data', function on_data(buffer){
			self.pause();
			outstandingWrites++;

			file.write(buffer, function on_buffer(){
				outstandingWrites--;
				self.resume();

				if(self.ended){
					self._parser.emit('doneWritingFile');
				}
			});
		});

		self._parser.on('end', function(){
			self._flushing--;
			self.ended = true;

			var done = function on_done(){
				file.end(function(){
					self.emit('file', 'file', file);
					self._maybeEnd();
				});
			}

			if(outstandingWrites === 0){
				done();
			}
			else{
				self._parser.once('doneWritingFile', done);
			}
		});
	}

	_initJSONencoded(){
		this.type = 'json';

		var parser = Content.JSON(this), self = this;

		parser.onField = function on_field(key, val){
			self.emit('field', key, val);
		}

		parser.onEnd = function on_end(){
			self.ended = true;
			self._maybeEnd();
		}

		this._parser = parser;
	}

	_uploadPath(filename){
		var buf = crypto.randomBytes(16);
		var name = 'upload_' + buf.toString('hex');

		if(this.keepExtensions){
			var ext = path.extname(filename);
			ext = ext.replace(/(\.[a-z0-9]+).*/i, '$1');

			name += ext;
		}

		return path.join(this.uploadDir, name);
	}

	_maybeEnd(){
		if(!this.ended || this._flushing || this.error){
			return;
		}

		this.emit('end');
	}
}

//exports
module.exports = FileRequestEmitter

function dummyParser(self){
	return {
		end: function(){
			self.ended = true;
			self._maybeEnd();
			return null;
		}
	};
}