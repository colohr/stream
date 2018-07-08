const EventEmitter = require('events').EventEmitter
const crypto = require('crypto')

class File extends EventEmitter{
	constructor(properties){
		super()
		this.size = 0
		this.path = null
		this.name = null
		this.type = null
		this.hash = null
		this.lastModifiedDate = null
		for(const key in properties) this[key] = properties[key]
		if(typeof this.hash === 'string') this.hash = crypto.createHash(properties.hash)
		else this.hash = null
	}
	json(buffer){
		if(this.hash){
			this.hash.update(buffer)
			this.hash = this.hash.digest('hex')
		}
		this.size = buffer.length
		this.lastModifiedDate = new Date()
		return {
			buffer,
			file:{
				hash: this.hash,
				modified: this.lastModifiedDate,
				mime: this.mime,
				name: this.name,
				size: this.size,
				path: this.path,
				type: this.type
			}
		}
	}

}

//exports
module.exports = function get_file(properties){
	return new File(properties)
}



//		this._writeStream = null
//open(){
//  this._writeStream = new fs.WriteStream(this.path);
//}
//write(buffer, cb){
//    var self = this;
//    if(self.hash){
//        self.hash.update(buffer);
//    }
//
//    if(this._writeStream.closed){
//        return cb();
//    }
//
//    this._writeStream.write(buffer, function(){
//        self.lastModifiedDate = new Date();
//        self.size += buffer.length;
//        self.emit('progress', self.size);
//        cb();
//    });
//}
//end(cb){
//    var self = this;
//    if(self.hash){
//        self.hash = self.hash.digest('hex');
//    }
//    this._writeStream.end(function(){
//        self.emit('end');
//        cb();
//    });
//}
