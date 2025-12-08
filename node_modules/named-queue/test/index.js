var tape = require('tape')
var namedQueue = require('..')

tape('processes single task', function(t) {
	var q = new namedQueue(function(task, cb) {
		t.ok(task, 'has task')
		t.equals(task.hello, 'world', 'proper task')
		setTimeout(cb, 300)
	})

	q.push({ hello: "world" }, function() {
		t.end()
	})
})


tape('processes many task, respects concurrency', function(t) {
	var concurrency = 0

	var q = new namedQueue(function(task, cb) {
		concurrency++
		t.ok(concurrency <= 2, 'concurrency alright')
		t.equals(task && task.hello, 'world', 'proper task')
		setTimeout(cb, 300)
	}, 2)

	var items = [1,2,3,4,5, 6]
	items.forEach(function(i) {
		q.push({ hello: "world", id: i }, function() {
			concurrency--
			if (!( concurrency || q.length())) t.end() // TODO: better end condition?
		})
	})
})


tape('de-duplicates tasks', function(t) {
	var concurrency = 0
	var atTheMoment = { }

	var q = new namedQueue(function(task, cb) {
		if (atTheMoment[task.id]) t.error('does not de-dup tasks');
		atTheMoment[task.id] = true
		concurrency++
		t.ok(concurrency <= 3, 'concurrency alright')
		t.equals(task && task.hello, 'world', 'proper task')
		setTimeout(cb, 300)
	}, 3)

	var items = [1,2,6,6,3,4,6,5,6]
	items.forEach(function(i) {
		q.push({ hello: "world", id: i }, function() {
			concurrency--
			atTheMoment[i] = false
			if (!( concurrency || q.length())) t.end() // TODO: better end condition?
		})
	})
})