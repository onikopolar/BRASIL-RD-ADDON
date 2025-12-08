function namedQueue(processor, concurrency) {
	concurrency = concurrency || 1

	var waiting = []

	var inProg = { }
	var count = 0

	//var paused = false

	function update() {
		while (waiting.length && count < concurrency) (function() {
			var t = waiting.shift()
			
			if (inProg[t.task.id]) {
				inProg[t.task.id].push(t.cb)
				return
			} else {
				inProg[t.task.id] = [t.cb]
				count++
				processor(t.task, function() {
					var args = arguments

					if (!inProg[t.task.id]) return // probably callback called twice
	
					count--
					inProg[t.task.id].forEach(function(cb) { cb.apply(null, args) })
					delete inProg[t.task.id]
	
					setImmediate(update)
				})
			}	
		})()
	}

	this.push = function(task, cb) {
		if (!task.hasOwnProperty('id')) throw new Error('no task.id')

		if (inProg[task.id]) { 
			inProg[task.id].push(cb)
			return 
		}
		waiting.push({ task: task, cb: cb })
		setImmediate(update)
	}

	this.unshift = function(task, cb) {
		if (inProg[task.id]) { 
			inProg[task.id].push(cb)
			return 
		}
		waiting.unshift({ task: task, cb: cb })
		setImmediate(update)
	}

	this.length = function() {
		return waiting.length
	}
}

module.exports = namedQueue
