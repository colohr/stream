const DataStream = require('./DataStream')
const Setting = require('./Setting')
//exports
module.exports = function create_middleware(on_done, ...x){
	const setting = Setting(...x)
	return function middleware(request, response, next){
		if(setting.matches(request)){
			const reader = new DataStream(setting.stream)
			return reader.read(request)
						 .then(data=>on_done(data,request, response,next))
						 .catch(error=>on_done({error}, request, response, next))
		}
		return next()
	}
}

