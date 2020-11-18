const { watch: fsWatch, promises: fs } = require('fs');
const EventEmitter = require('events')

class biMap {
	constructor() {
		this._inoMap = new Map()
		this._fileMap = new Map()
	}

	getByIno = ino => this._inoMap.get(ino)
	getByFile = file => this._fileMap.get(file)

	set = (ino, file) => [this._inoMap.set(ino, file), this._fileMap.set(file, ino)]

	deleteByIno = ino => [this._fileMap.delete(this._inoMap.get(ino)), this._inoMap.delete(ino)]
	deleteByFile = file => [this._inoMap.delete(this._fileMap.get(file)), this._fileMap.delete(file)]
}

module.exports.recursiveWatch = async srcPath => {
	const inoFileLookup = new biMap()
	const eventEmitter = new EventEmitter()

	const recurseBuild = async _rootDir => {
		if ((await fs.stat(_rootDir)).isDirectory()) {
			for (let path of (await fs.readdir(_rootDir))) {
				path = `${_rootDir}/${path}`
				const stat = await fs.stat(path)
				if (stat.isDirectory()) recurseBuild(path)
				else inoFileLookup.set(stat.ino, path)
			}
		}
		inoFileLookup.set((await fs.stat(_rootDir)).ino, _rootDir)
	}

	// Build the inoFileLookup
	await recurseBuild(srcPath)

	const watch = async _rootPath => {
		const listener = async (type, path) => {
			path = `${_rootPath}/${path}`
			const stats = await fs.stat(path).catch(() => {})
			if (type === 'rename') {
				if (stats !== undefined) {
					const inoFile = inoFileLookup.getByIno(stats.ino)
					inoFileLookup.set(stats.ino, path)
					if (inoFile !== undefined) eventEmitter.emit('renamed', { path, src: inoFile, dest: path, stats })
					else {
						eventEmitter.emit('created', { path, stats })
						if (stats.isDirectory()) watch(path)
					}
				} else eventEmitter.emit('deleted', { path })
			} else eventEmitter.emit('changed', { path, stats })
		}
		
		const stats = await fs.stat(_rootPath)
		if (stats.isDirectory()) {
			await Promise.all((await fs.readdir(_rootPath)).map(async subPath => {
				if ((await fs.stat(`${_rootPath}/${subPath}`)).isDirectory()) await watch(`${_rootPath}/${subPath}`)
			}))
		}
		
		fsWatch(_rootPath, listener)
		.on('error', err => eventEmitter.emit('err', err))
		eventEmitter.emit('watching', { path: _rootPath, stats })
	}
	await watch(srcPath)
	return eventEmitter
}


module.exports.test = async rootDir => {
	const startTime = new Date()
	const fileEvents = await module.exports.recursiveWatch(rootDir).catch(console.log)
	console.log(`Cache built in ${new Date()-startTime}ms! Listening for events...`)
	fileEvents.on('deleted', info => console.log(info.path, `deleted`))
	fileEvents.on('created', info => console.log(info.path, `created`))
	fileEvents.on('renamed', info => console.log({ src: info.src, dest: info.dest }, `renamed`))
	fileEvents.on('watching', info => console.log(info.path, `watching`))
	fileEvents.on('changed', info => console.log(info.path, `changed`))
}