if(typeof console=='undefined')var console={log:function(){}};
if(typeof hunch=='undefined')var hunch={};

/**
 * HTML file uploads with support for multiple uploads and progress indication.
 *
 * If the client is a HTML5-capable browser, progress will be reported, concurrent
 * uploads enabled and extensive state events are posted. Otherwise, if the client
 * does not support the HTML5 File API, a less rich but fully functional
 * iframe+form technique is used. In that case progress is only reported as 0.0 or
 * 1.0 and certain events are not posted.
 *
 * Old browsers will no be able to emit certain events. The only events that you
 * can rely on are:
 *
 *  - onStart
 *  - onProgress
 *  - onSuccess (In case of old browsers, this is called even if an error occured)
 *  - onComplete
 *
 * Author:  Rasmus Andersson <http://hunch.se/>
 * License: MIT <http://en.wikipedia.org/wiki/MIT_License>
 */

/**
 * Initiate and/or configure file ulpoading for a file form element.
 *
 * @param fileInputElement An <input type=file> element.
 *
 * @param handlerOrURL Mixed:
 * - If <handlerOrURL> is a function, handler will be called with a new hunch.FileUpload
 *   object for each file that should be sent. In this case the <handlerOrURL> takes over the
 *   responsibility of calling send() on the hunch.FileUpload object.
 * - If <handlerOrURL> is a string, hunch.FileUpload.send(handlerOrURL) will be called on
 *   each file.
 * - If <handlerOrURL> is not specified (or if it's not a function or string), no action is
 *   taken. In this case you have the responsibility to call send() on the files returned.
 *
 * @return An array of hunch.FileUpload objects.
 */
hunch.upload = function(fileInputElement, handlerOrURL) {
	var fus = [];
	var maxSize = 0.0;
	try {
		maxSize = Number(fileInputElement.getAttribute('maxlength'));
	} catch(e) {}

	var _upload_file = function(file) {
		// Create object
		var fu = new hunch.FileUpload(file);
		fu.fileInputElement = fileInputElement;

		// Check size
		if (maxSize > 0 && file.fileSize > maxSize) {
			throw new hunch.FileSizeOutOfBoundsException(
				'File "'+file.fileName+'" is too big (size: '+
				Number(file.fileSize/1024).toFixed(1)+' kB, max size: '+
				Number(maxSize/1024).toFixed(1)+')', fu);
		}

		// Add to list of files
		fus.push(fu);

		// handlerOrURL?
		if (typeof handlerOrURL == 'function') {
			handlerOrURL(fu);
		}
		else if (typeof handlerOrURL == 'string') {
			var _onSuccess = fu.onSuccess;
			fu.onSuccess = function(responseText) {
				fileInputElement.value = '';
				if (typeof _onSuccess == 'function')
					_onSuccess.call(this, responseText);
			};
			fu.send(handlerOrURL);
		}
	};

	// <for each input file>
	if (hunch.capabilities.fileAPI) {
		// if the fileInputElement is a multiple field, upload all files
		var file = null;
		for (var i=0; i<fileInputElement.files.length; i++) { 
			file = fileInputElement.files[i];
			if (file && file.fileSize)
				_upload_file(file);
		}
	}
	else {
		var file = new hunch.SimulatedFile(fileInputElement);
		if (fileInputElement.maxLength && typeof fileInputElement.maxLength == 'number')
			file.size = file.fileSize = Number(fileInputElement.maxLength);
		_upload_file(file);
	}

	return fus;
};

/**
 * Represents a file that can be uploaded.
 *
 * Note that normally you'd use hunch.upload() rather than instantiating a
 * FileUpload directly.
 *
 * @param file Should be a File object
 *   (see http://dev.w3.org/2006/webapi/FileUpload/publish/FileAPI.html)
 */
hunch.FileUpload = function(file) {
	// Public member variables
	this.file = file;
	this.xhr = null;
	this.fileInputElement = null;
	this.bytesLoaded = 0;
	this.bytesTotal = typeof file.fileSize != 'undefined' ? file.fileSize : 0;
	this.name = this.file.fileName;
	this.urlParameterNames = {filename:'filename'};
	this.opaqueProperties = {}; // key-values send along to the receiver of send()

	this.type = '';
	if (typeof this.file.mediaType != 'undefined')
		this.type = this.file.mediaType;
	else if (typeof this.file.fileType != 'undefined')
		this.type = this.file.fileType;
	else if (typeof this.file.fileMediaType != 'undefined')
		this.type = this.file.fileMediaType;

	// local temporary variables
	var self = this; // local binding
	/** URL complete with parameters */
	var composeURL = function(url) {
		self.opaqueProperties[self.urlParameterNames.filename] = self.name;
		return hunch.util.addParamsToURL(url, self.opaqueProperties);
	};

	// Public member events

	/** Called when the request has been set up */
	this.beforeSend = function() {};
	/** Called just before the connection is initiated */
	this.onStart = function() {};
	/** Called after a connection has been established, but before the requests begins */
	this.onConnected = function() {};
	/** Called after the requests has been sent */
	this.onSent = function() {};

	/** Called when the progress of the upload was updated */
	this.onProgress = function() {};

	/** Called when the upload completed */
	this.onSuccess = function(responseText) {};
	/** Called when the upload was aborted by the user */
	this.onAbort = function() {};
	/** Called when the upload failed with error */
	this.onError = function(exception, responseText) {
		// default impl. emits debug msg and propagates any exception up the chain 
		if (hunch.debug) console.log('error: "'+this.name+'" failed with status: '+
			(this.xhr ? this.xhr.status : '0')+
			', response: "'+responseText+'"');
		if (typeof exception != 'undefined' && exception)
			throw exception;
	};

	/** Called after the finished (<textStatus> is "success", "abort" or "error") */
	this.onComplete = function(textStatus, responseText) {};

	// Private member events
	this._onComplete = function(status, responseText) {
		return this.onComplete(status, responseText);
	}

	// Compatibility implementations of send
	if (!hunch.capabilities.fileAPI) {
		// No File API -- hack around it with a form and iframe
		this.send = function(url, method_ignored) {
			var self = this; // local binding
			var iframeID = '_hunch_upload_iframe_'+(new Date()).getTime();
			var iframe = null;
			var fileInputElementOrigParent = this.fileInputElement.parentNode;

			try {
				var fr = document.createElement('iframe');
				fr.setAttribute('id', iframeID);
				fr.setAttribute('name', iframeID);
				fr.setAttribute('frameborder', '0');
				iframe = document.body.appendChild(fr);
				if (!iframe)
					iframe = document.frames ? document.frames[iframeID] : fr;
				iframe.style.border = '0px';
				iframe.style.width = '0px';
				iframe.style.height = '0px';
				iframe.style.display = 'none';
			}
			catch (e) {
				// This is for IE5 PC, which does not allow dynamic creation
				// and manipulation of an iframe object. Instead, we'll fake
				// it up by creating our own objects.
				var html = '\<iframe id="'+iframeID+'" name="'+iframeID+
					'" style="border:0px;width:0px;height:0px;display:none;" frameborder="0"><\/iframe>';
				document.body.innerHTML += html;
				iframe = new Object();
				iframe.document = new Object();
				iframe.document.location = new Object();
				iframe.document.location._iframe = document.getElementById(iframeID);
				iframe.document.location.replace = function(loc) { this._iframe.src = loc; }
			}

			// intercept load events for iframe
			hunch.util.observeEvent(iframe, 'load', function(ev) {
				// normalize iframe document access
				if (iframe.contentDocument)
					iframe.doc = iframe.contentDocument; 
				else if (iframe.contentWindow)
					iframe.doc = iframe.contentWindow.document;
				else if (iframe.document)
					iframe.doc = iframe.document;
				else
					iframe.doc = window.frames[iframe.name].document;

				if (hunch.debug) console.log('compat: iframe load', ev, iframe.doc.readyState);

				// Opera 9.2 fires load event multiple times even when the DOM is not ready yet
				if (iframe.doc.readyState && iframe.doc.readyState != 'complete')
					return;

				// Opera 9.64: event was fired second time when body.innerHTML changed from false 
				// to server response approx. after 1 sec
				if (iframe.doc.body && iframe.doc.body.innerHTML == 'false')
					return;
				var responseText = null;
				if (hunch.capabilities.jQuery)
					responseText = $(iframe.doc).text();
				// 100%
				self.progress = 1.0;
				self.onProgress();
				// Remove temporary elements
				fileInputElementOrigParent.appendChild(self.fileInputElement);
				form.parentNode.removeChild(form);
				iframe.parentNode.removeChild(iframe);
				// Callbacks
				self.onSuccess(responseText); // might as well have failed, we can't tell :(
				self._onComplete("success", responseText);
			});

			// create form
			// must be single-shot because changing this attr on the fly is not allowed in IE 6/7
			var form = hunch.util.evalHTML('<form method="POST" enctype="multipart/form-data"></form>');
			form.action = composeURL(url);
			form.target = iframe.name;
			form.style.display = 'none';
			if (!this.fileInputElement.name || !this.fileInputElement.name.length)
				this.fileInputElement.name = 'file';
			form.appendChild(this.fileInputElement);

			// add form to body
			fileInputElementOrigParent.appendChild(form);

			// submit
			if (hunch.debug) console.log('compat: form-send: submitting', form);
			this.onStart();
			this.progress = 0.0;
			this.onProgress();
			form.submit();
		}

		/** Abort the upload */
		this.abort = function() {
			// todo: ability to abort compat. form/iframe-based uploads
			iframe.abort();
		};
	}
	else {
		// Have File API
		this.xhr = new XMLHttpRequest();

		// Private method
		this._xhrSend = function(url, method) {
			if (typeof method != 'string')
				method = 'POST';
			try {
				// open connection
				this.xhr.open(method, composeURL(url));
				//this.xhr.setRequestHeader('Content-Length', this.file.fileSize); // not allowed
				try {
					this.xhr.overrideMimeType('application/octet-stream');
				} catch(e) {
					try {
						this.xhr.overrideMimeType('text/plain; charset=x-user-defined-binary');
					} catch(e) {}
				}
				this.onStart();
				this.onProgress();
				// payload
				var payload = this.file;
				if (typeof this.file.getAsBinaryText != 'undefined')
					payload = this.file.getAsBinaryText();
				else if (typeof this.file.getAsBinary != 'undefined')
					payload = this.file.getAsBinary();
				// todo: MSIE
				// send body
				if (typeof this.xhr.sendAsBinary != 'undefined')
					this.xhr.sendAsBinary(payload);
				else
					this.xhr.send(payload);
				payload = null; // make sure the data is GC'ed
			}
			catch(e) {
				this.onError(e, self.xhr.responseText);
				self._onComplete("error", this.xhr.responseText);
			}
		};
		this.send = this._xhrSend;

		if (!hunch.capabilities.concurrentUploads) {
			// Unable to handle concurrent uploads? Wrap send() in queued version
			this.send = function(url, method) {
				hunch.uploadQueue.schedule(this, url, method);
			}
		}

		/** Abort the upload */
		this.abort = function() {
			// todo: ability to abort compat. form/iframe-based uploads
			this.xhr.abort();
		};

		// Setup XHR event handlers
		this.xhr.upload.onprogress = function(evt) {
			if (hunch.debug) console.log('xhr.upload.onprogress', evt);
			if (evt.lengthComputable) {
				self.bytesLoaded = evt.loaded;
				self.bytesTotal = evt.total;
				var progress = (self.bytesLoaded / self.bytesTotal);
				if (progress < 1.0)
					self.progress = progress;
				if (hunch.debug) console.log('progress =', self.progress);
			}
			else {
				self.haveDeterminableProgress = false;
			}
			self.onProgress();
		};

		this.xhr.upload.onloadstart = function(evt) {
			if (hunch.debug) console.log('xhr.upload.onloadstart', evt);
			self.onConnected();
		};
		this.xhr.upload.onabort = function(evt) {
			if (hunch.debug) console.log('xhr.upload.onabort', evt);
			self.onAbort(evt);
			self._onComplete("abort", self.xhr.responseText);
		};

		this.xhr.onload = function(evt) {
			if (hunch.debug) console.log('xhr.upload.onload', evt);
			self.progress = 1.0;
			self.bytesLoaded = self.bytesTotal;
			self.onProgress();
			var textStatus = 'success';
			if (self.xhr.status < 200 || self.xhr.status > 299) {
				self.onError(null, self.xhr.responseText);
				textStatus = 'error';
			}
			else {
				self.onSuccess(self.xhr.responseText);
			}
			self._onComplete(textStatus, self.xhr.responseText);
		};
		this.xhr.upload.onerror = function(evt) {
			if (hunch.debug) console.log('xhr.upload.onerror', evt);
			self.onError(null, self.xhr.responseText);
			self._onComplete("error", self.xhr.responseText);
		};
		this.xhr.onreadystatechange = function(pcb) {
			if (hunch.debug) console.log('xhr.onreadystatechange '+this.readyState, pcb, self.file.fileName);
			/*
				0	request is not initialized
				1	request has been set up
				2	request has been sent
				3	request is in process
				4	request is complete
			*/
			if (this.readyState == 1)
				self.beforeSend();
			else if (this.readyState == 2)
				self.onSent();
		};
	}

	if (hunch.debug) console.log('new hunch.FileUpload =>', this);
}

	/**
	 * Exception thrown by upload() if the file is larger than maxlength attribute of
	 * a file input element.
	 */
hunch.FileSizeOutOfBoundsException = function(msg, file) {
	this.message = msg;
	this.file = file;
	this.toString = function() {return 'FileSizeOutOfBoundsException: '+msg;};
};

/**
 * Used by browsers having problems with concurrent uploads.
 */
hunch.uploadQueue = {
	q: [],
	sending: false,
	checkSendTimer: null,

	schedule: function(file, url, method) {
		if (hunch.debug) console.log('uploadQueue: scheduling '+file.name);
		// we need to know when it's done
		file._onComplete = function(status, responseText) {
			this.onComplete(status, responseText);
			hunch.uploadQueue.onComplete(file);
		};
		// queue
		hunch.uploadQueue.q.push({file:file, url:url, method:method});
		if (!hunch.uploadQueue.sending)
			hunch.uploadQueue.sendNext();
		else if (hunch.uploadQueue.checkSendTimer == null)
			hunch.uploadQueue.checkSendTimer = setInterval(hunch.uploadQueue._checkSend, 100);
	},

	_checkSend: function() {
		if (hunch.uploadQueue.sending == false)
			hunch.uploadQueue.sending.sendNext();
	},

	sendNext: function() {
		if (!hunch.uploadQueue.q.length) {
			if (hunch.debug) console.log('uploadQueue: upload queue empty');
			if (hunch.uploadQueue.checkSendTimer != null) {
				clearTimeout(hunch.uploadQueue.checkSendTimer);
				hunch.uploadQueue.checkSendTimer = null;
			}
			return;
		}
		var t = hunch.uploadQueue.q.shift();
		hunch.uploadQueue.sending = true;
		if (hunch.debug) console.log('uploadQueue: sending '+t.file.name);
		t.file._xhrSend(t.url, t.method);
	},

	onComplete: function(file) {
		if (hunch.debug) console.log('uploadQueue: completed '+file.name);
		hunch.uploadQueue.sending = false;
		hunch.uploadQueue.sendNext();
	}
};

/**
 * Utilities.
 */
hunch.util = {
	/** Evaluate HTML to DOM struct */
	evalHTML: function(html){
		if (!hunch.util.evalHTML.div)
			hunch.util.evalHTML.div = document.createElement('div');
		hunch.util.evalHTML.div.innerHTML = html;
		var el = hunch.util.evalHTML.div.childNodes[0];
		hunch.util.evalHTML.div.removeChild(el);
		return el;
	},

	observeEvent: function(element, type, cb){
		if (window.addEventListener)
			element.addEventListener(type, cb, false);
		else if (window.attachEvent)
			element.attachEvent('on' + type, function(){ cb.call(element, window.event); });
	},

	addParamsToURL: function(url, keyvaluepairs) {
		var len = 0;
		for (var k in keyvaluepairs)
			len++;
		if (len && typeof url == 'string') {
			url = url + ((url.indexOf('?') == -1) ? '?' : '&');
			var i = 0;
			for (var k in keyvaluepairs) {
				url += encodeURIComponent(''+k)+'='+encodeURIComponent(''+keyvaluepairs[k])
					+(i++ < len-1 ? '&' : '');
			}
		}
		return url;
	}/*,

	|** Read file in MSIE *|
	msieReadFile: function(filename) {
		try {
			var fso  = new ActiveXObject("Scripting.FileSystemObject"); 
			var fh = fso.OpenTextFile(filename, 1); 
			var contents = fh.ReadAll(); 
			fh.Close();
			return contents;
		}
		catch (e) {
			return null;
		}
	}*/
};

/**
 * Set to true to enable printing of debug messages to console
 * and to enable work in progress.
 */
if(typeof hunch.debug=='undefined')hunch.debug = false;

/**
 * Set to true to enable work in progress.
 */
if(typeof hunch.devel=='undefined')hunch.devel = false;

/**
 * File impl for non-html-5 compatible browsers.
 *
 * Note: This is incomplete work in progress.
 */
hunch.SimulatedFile = function(fileInputElement) {
	this.name = this.fileName = fileInputElement.value;
	this.size = this.fileSize = 0;
	this.mediaType = 'application/octet-stream';
	this.url = undefined;
	this.hunchSimulated = true;
	if (hunch.debug) console.log('new hunch.SimulatedFile =>', this);
};

/**
 * Environment capabilities
 */
hunch.capabilities = {
	fileAPI: true,
	concurrentUploads: true,
	jQuery: typeof jQuery != 'undefined'
};

// check capabilities
(function(){

	// HTML5 File API? ("XHR uploads")
	if (typeof document != 'undefined' && typeof document.createElement != 'undefined') {
		hunch.capabilities.fileAPI = typeof document.createElement('input').files != 'undefined';
	}

	// Can handle concurrent uploads (i.e. concurrent conncetions rather than queued) with File API?
	/*
	This was initially created for AppleWebKit <532 which was incorrectly thought to
	have issues with concurrent uploads (Turned out to be a console concurrency problem).
	*/
	/*var ua = navigator.userAgent;
	// Older versions of Safari have issues. Tested on OS X (windows version untested)
	var p = ua.indexOf('AppleWebKit/');
	if (p != -1) {
		// AppleWebKit 532 is confirmed to work, 531 is confirmed to fail.
		var e = ua.indexOf(' ', p+1);
		var v = Number(ua.substring(p+'AppleWebKit/'.length, e).replace(/^[^0-9]*([0-9]+)(\..+|)$/, '$1'));
		hunch.capabilities.concurrentUploads = (v >= 532);
	}*/

	// summary on console
	console.log('hunch.capabilities =>', hunch.capabilities);
})();

/* xxx dev test form uploads >> */ //hunch.capabilities.fileAPI = false;

// maybe a jQuery entry point in the future?
/*if (hunch.capabilities.jQuery) {
	jQuery.fn.upload = function() {
	  return this.each(function() {
	    alert(this);
	  });
	};
}*/
