const fxy = require('fxy')

const DataStreamSettingPreset = ()=>({
	encoding: 'utf-8',
	hash: 'sha1',
	keep_extensions: false,
	max_fields: 1000,
	max_fields_size: 20971520,
	max_file_size: 20971520,
	multiples: false,
	upload_folder: fxy.join(process.cwd(), 'stream_upload_temporary')
})

class DataStreamSetting{
	constructor(options = {}){
		this.content_type = 'multipart/form-data'
		this.method = 'POST'
		this.stream = DataStreamSettingPreset()
		for(const field in options){
			switch(field){
				case 'url':
					this.url = get_matcher(options[field])
					break
				default:
					this[field] = options[field]
					break
			}
		}
	}
	matches(request){
		return is_method(this, request) && is_url(this, request)
	}
}

//exports
module.exports = (...x)=>new DataStreamSetting(...x)

//shared actions
function get_matcher(url){
	const {Minimatch} = require('minimatch')
	return new Minimatch(url)
}

function is_method(setting, request){
	return setting.method === request.method && request.header('content-type').indexOf(setting.content_type) === 0
}

function is_url(setting, request){
	return 'url' in setting ? setting.url.match(request.url):true
}

