const FileRequestEmitter = require('./FileRequestEmitter')
const File = require('./File')
const StringDecoder = require('string_decoder').StringDecoder
const fxy = require('fxy')
const DataStreamSetting = require('../Setting')


class DataStream extends FileRequestEmitter{
	static get is(){ return require('./is') }
	constructor(options){
		super()
		if(!fxy.is.data(options)) options = DataStreamSetting().stream
		this.error = null
		this.ended = false

		this.maxFields = options.max_fields
		this.maxFieldsSize = options.max_fields_size
		this.maxFileSize = options.max_file_size
		this.keepExtensions = options.keep_extensions
		this.uploadDir = options.upload_folder
		this.encoding = options.encoding
		this.headers = null
		this.type = null
		this.hash = options.hash
		this.multiples = options.multiples

		this.bytesReceived = null
		this.bytesExpected = null

		this._parser = null
		this._flushing = 0
		this._fieldsSize = 0
		this._fileSize = 0
		this.openedFiles = []
	}
	writeHeaders(headers){
		this.headers = headers
		this._parseContentLength()
		this._parseContentType()
	}

	pause(){
		// this does nothing, unless overwritten in IncomingForm.parse
		return false
	}
	read(request){
		const fields = {}
		const files = {}
		this.pause = pause_request
		this.resume = resume_request

		return new Promise((success,error)=>{
			this.writeHeaders(request.headers)

			this.on('field', on_field)
				.on('file', on_file)
				.on('error', on_error)
				.on('end', on_end)

			//exports
			return request_listeners(this, request)

			//shared actions
			function on_end(){
				return success({fields,files})
			}
			function on_error(e){
				return error({error:e, data:{fields,files}})
			}
		})

		//shared actions
		function on_field(name,value){ fields[name] = value }

		function on_file(name,file){
			if(this.multiples){
				if(files[name]){
					if(!Array.isArray(files[name])) files[name] = [files[name]]
					files[name].push(file)
				}
				else files[name] = file
			}
			else files[name] = file
		}

		function pause_request(){
			try{ request.pause() }
			catch(e){
				if(!this.ended) this._error(e)
				return false
			}
			return true
		}

		function resume_request(){
			try{ request.resume() }
			catch(e){
				if(!this.ended) this._error(e)
				return false
			}
			return true
		}

	}
	resume(){
		// this does nothing, unless overwritten in IncomingForm.parse
		return false
	}
	field(stream){
		let value = ''
		const decoder = new StringDecoder(this.encoding)

		stream.on('data', buffer=>{
			this._fieldsSize += buffer.length
			if(this._fieldsSize > this.maxFieldsSize) this._error(new Error(`maxFieldsSize exceeded, received ${this._fieldsSize} bytes of field data`))
			value += decoder.write(buffer)
		})

		stream.on('end', ()=>this.emit('field', stream.name, value))
	}
	file(stream){
		let file_buffer = []
		let file = new File({
			path: this._uploadPath(stream.filename),
			name: stream.filename,
			type: stream.mime,
			hash: this.hash
		})

		stream.on('data', buffer=>{
			this._fileSize += buffer.length
			if(this._fileSize > this.maxFileSize) return this._error(new Error(`File Stream: maxFileSize exceeded, received ${this._fileSize} bytes of file data`))
			if(buffer.length == 0) return
			this.pause()
			file_buffer.push(buffer)
			this.resume()
		})

		stream.on('end', ()=>{
			this._flushing--
			this.emit('file', file.name, file.json(Buffer.concat(file_buffer)))
			this._maybeEnd()
			file = null
			file_buffer = []
		})
	}
	stream(item){
		if(item.filename === undefined) return this.field(item)
		this._flushing++
		return this.file(item)
	}
	write(buffer){
		if(this.error) return
		if(!this._parser) return this._error(new Error('uninitialized parser'))

		this.bytesReceived += buffer.length
		this.emit('progress', this.bytesReceived, this.bytesExpected)

		var bytesParsed = this._parser.write(buffer)
		if(bytesParsed !== buffer.length) this._error(new Error(`parser error, ${bytesParsed} of ${buffer.length} bytes parsed`))

		return bytesParsed
	}
}

//exports
module.exports = DataStream


//shared actions
function request_listeners(emitter, request){
	let error = null
	request.on('error', on_error)
	   .on('aborted', on_aborted)
	   .on('data', on_data)
	   .on('end', on_end)

	//shared actions
	function on_aborted(){
		emitter.emit('aborted');
		emitter._error(new Error('Request aborted'));
	}

	function on_data(buffer){
		emitter.write(buffer)
	}

	function on_end(){
		if(emitter.error) return
		error = emitter._parser.end()
		if(error) emitter._error(error)
	}
	function on_error(e){
		emitter._error(e)
	}
}
