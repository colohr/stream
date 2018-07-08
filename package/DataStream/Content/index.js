const Content = {
	JSON(...x){
		return new (require('./JSON'))(...x)
	},
	Multipart(...x){
		return new (require('./Multipart'))(...x)
	},
	Octet(...x){
		return new (require('./Octet'))(...x)
	},
	Querystring(...x){
		return new (require('./Querystring'))(...x)
	}
}

//exports
module.exports = Content