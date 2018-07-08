const upload = require('./upload')

//exports
module.exports = function create_router(...x){
	return function router(request, response, next){

		if(is_multipart(request, ...x)){
			return upload(request).then(on_upload).catch(on_error)
		}
		else next()

		//shared actions
		function on_error(error){
			return response.json({error: error.message})
		}

		function on_upload(data){
			return response.json(data)
		}
	}
}


