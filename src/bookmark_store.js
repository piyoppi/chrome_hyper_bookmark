import simpleSearcher from './simple_searcher.js'

export default class bookmarkStore{

    static DB_VERSION(){ return 1 }

    constructor(){
        this._dataVersion = 0;
        this._db = null;

        this.__allDatas = { version: -1, data: null};
        this.__findResults = {query: "", version: -1, data: null};
        this.__keyList = [];

        this._STRMAX_LEN = 1500;
        this._MAX_ITEMS = 1500;
        this._TAG_STRMAX= 30;
        this._TAG_MAX_ITEMS = 100;

        this.bookmarkCount = 0;
        this.tagCount = 0;
        this.InitializeDatabase();
    }

    getKeyList(){
        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["bookmarks"], "readwrite");
            let objectStore = transaction.objectStore("bookmarks");
            this.__keyList.length = 0;
            objectStore.openCursor().onsuccess = e => {
                let cursor = e.target.result;
                if( cursor ){
                    this.__keyList.push( cursor.key );
                    cursor.continue();
                }
                else{
                    this.__keyList.sort( (a, b)=>b-a );
                    resolve(this.__keyList);
                }
            }
        });
    }

    validateTagData(data, isAdd = true){
        if( data.tagName.length > this._TAG_STRMAX){
            return {result: false, cause: "InvalidStrLenError", code: 3}
        }
        if( isAdd ){
            let chkIsFillTagDatabase = this.checkIsFillTagDatabase();
            if( !chkIsFillTagDatabase.result ) return chkIsFillTagDatabase;
        }
        return {result: true, cause: "", code: 0}
    }
    checkIsFillTagDatabase( addCount = 0, isThrow = false ){
        let compCount = (this.tagCount + addCount);
        if( compCount > this._TAG_MAX_ITEMS){
            if( isThrow ) {
                throw {result: false, cause: "DatabaseFullError", diff: compCount - this._TAG_MAX_ITEMS, code: 4}
            }
            else{
                return {result: false, cause: "DatabaseFullError", diff: compCount - this._TAG_MAX_ITEMS, code: 4}
            }
        }
        return {result: true, cause: "", code: 0}
    }


    validateBookmarkData(data, isAdd = true){
        if( data.text_for_finding.length > this._STRMAX_LEN ){
            return {result: false, cause: "InvalidStrLenError", code: 1}
        }
        if( isAdd ){
            let chkIsFillBookmarkDatabase = this.checkIsFillBookmarkDatabase();
            if( !chkIsFillBookmarkDatabase.result ) return chkIsFillBookmarkDatabase;
        }
        return {result: true, cause: "", code: 0}
    }

    checkIsFillBookmarkDatabase( addCount = 0, isThrow = false ){
        let compCount = (this.bookmarkCount + addCount);
        if( compCount > this._MAX_ITEMS ){
            if( isThrow ) {
                throw {result: false, cause: "DatabaseFullError", diff: compCount - this._MAX_ITEMS, code: 2}
            }
            else{
                return {result: false, cause: "DatabaseFullError", diff: compCount - this._MAX_ITEMS, code: 2}
            }
        }
        return {result: true, cause: "", code: 0}
    }

    getBookmarkCount(){
        let transaction = this._db.transaction(["bookmarks"], "readwrite");
        let objectStore = transaction.objectStore("bookmarks");
        objectStore.count().onsuccess = (e)=>{
            this.bookmarkCount = e.target.result;
        };
    }

    getTagCount(){
        this._db.transaction(["tags"], "readwrite").objectStore("tags").count().onsuccess = (e)=>{
            this.tagCount = e.target.result;
        };
    }

    InitializeDatabase(){
        var request = window.indexedDB.open("Bookmarkers", this.DB_VERSION);
        request.onsuccess = (e) => {
            this._db = e.target.result;
            this.getBookmarkCount();
            this.getTagCount();
            this.getKeyList().then();
        }
        request.onerror = () => {};
        request.onupgradeneeded = (e) => { 
            this._db = e.target.result;
            //Bookmarks 
            var objectStore = this._db.createObjectStore("bookmarks", {keyPath: "id", autoIncrement: true });
            objectStore.createIndex("text_for_dupcheck", "text_for_dupcheck", { unique: true });
            //Tags
            var tagStore = this._db.createObjectStore("tags", {keyPath: "id", autoIncrement: true});
            tagStore.createIndex("tagName", "tagName", { unique: true });
        };

    }

    getTextForDuplicateCheck(data){
        return data.title + data.header_tag_text + data.url.replace(/#.*/, "");
    }

    genTextForFinding(data){
        return (data.content+ " " + data.header_tag_text + " " + data.title).toLowerCase().replace(/\r|\n|\r\n/g, "");
    }

    detachTag(key, tagKey){
        this.getTagFromKey(tagKey).then( e => {
            let transaction = this._db.transaction(["tags"], "readwrite");
            let objectStore = transaction.objectStore("tags");
            let keyPosition = e.contentIDs.indexOf(key);
            if( keyPosition != 0 ) return;
            if( e.contentIDs.length === 1 ){
                this.removeTag(tagKey);
            }
            else{
                e.contentIDs.splice(keyPosition, 1);
            }
            let request = objectStore.put(e);
            request.onerror = e => { };
            request.onsuccess = e => { };
        });
    }

    removeTag(tagKey){
        let transaction = this._db.transaction(["tags"], "readwrite");
        let objectStore = transaction.objectStore("tags");
        objectStore.delete(tagKey);
        this.tagCount--;
    }

    detachTagFromAllBookmark(tagKey){
        return this.getTagFromKey(tagKey).then( tag => {
            if( !tag ) throw "TagNoneException";
            let transaction = this._db.transaction(["tags"], "readwrite");
            let objectStore = transaction.objectStore("tags");
            let promisesBmark = [];
            tag.contentIDs.forEach( contentID => promisesBmark.push(this.getBookmark(contentID)));
            return Promise.all(promisesBmark).then( results => {
                let promisesUpdate = [];
                results.forEach( bookmark => {
                    if( !bookmark ) return;
                    let idx = bookmark.tagIds.indexOf(tagKey);
                    if( idx >= 0 ){
                        bookmark.tagIds.splice(idx, 1);
                        promisesUpdate.push(this.updateBookmarkData(bookmark));
                    }
                });
                return Promise.all(promisesUpdate).then;
            });
        });
    }

    getOrCreateTag(tagName){
        return this.getTag(tagName).then( e => {
            if( e ){
                return Promise.resolve({tag: e, isAddTag: false});
            }
            else{
                return this.addTag(tagName).then( e => Promise.resolve({tag: e, isAddTag: true}) );
            }
        } )
    }

    attachTagFromDataKey(datakey, tagName){
        return this.getBookmark(datakey).then( data => {
            if( !data ) throw "NoDataError";
            return this.addBookmarkKeyIntoTag(datakey, tagName).then( taginfo => {
                this.addTagKeyIntoBookmark(data, taginfo.tag.id);
                return Promise.resolve(taginfo);
            })
        });
    }

    detachTagFromDataKey(dataKey, tagKey){
        return this.getBookmark(dataKey).then( bookmark => {
            if( !bookmark ) throw "BookmarkItemNoneException";
            let findTagIndex = bookmark.tagIds.indexOf(tagKey);
            if( findTagIndex >= 0 ){
                bookmark.tagIds.splice(findTagIndex, 1);
                return this.updateBookmarkData(bookmark);
            }
            else{
                throw "UndefinedTagIndexException";
            }
        })
        .then( e => this.getTagFromKey(tagKey) )
        .then( tagData => {
            let findDataIndex = tagData.contentIDs.indexOf(dataKey);
            if( findDataIndex >= 0 ){
                tagData.contentIDs.splice(findDataIndex, 1);
                this.updateTag(tagData);
            }
            return Promise.resolve(tagData);
        });
    }

    addTagKeyIntoBookmark(data, tagkey){
        data.tagIds.push(tagkey);
        this.updateBookmarkData(data).then( e=>{} );
    }

    checkDuplicateTag(dataKey, tag){
        return ( tag.contentIDs.indexOf(dataKey) === -1 );
    }

    addBookmarkKeyIntoTag(dataKey, tagName){
        return this.getOrCreateTag(tagName).then( taginfo => {
            if( !this.checkDuplicateTag(dataKey, taginfo.tag) ) throw "TagDuplicateError";
            taginfo.tag.contentIDs.push(dataKey);
            return new Promise( (resolve, reject) => {
                let transaction = this._db.transaction(["tags"], "readwrite");
                let objectStore = transaction.objectStore("tags");
                let request = objectStore.put(taginfo.tag);
                request.onsuccess = e => resolve(taginfo);
                request.onerror = e => reject(e);
            });
        });
    }

    getTag(tagName){
        let transaction = this._db.transaction(["tags"], "readwrite");
        let objectStore = transaction.objectStore("tags");
        let index = objectStore.index("tagName");
        return new Promise( (resolve, reject) => {
            let request = index.get(tagName);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = e => reject(e);
        });
    }

    updateTag(tag){
        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["tags"], "readwrite");
            let objectStore = transaction.objectStore("tags");
            let requestUpdate = objectStore.put(tag);
            requestUpdate.onerror = e => reject({missedTag: tag, err: e});
            requestUpdate.onsuccess = e => resolve(tag);
        });
    }

    getTagFromKey(key){
        let transaction = this._db.transaction(["tags"], "readwrite");
        let objectStore = transaction.objectStore("tags");
        return new Promise( (resolve, reject) => {
            let request = objectStore.get(key);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = e => reject(e);
        });
    }

    getTagsAll(){
        return new Promise( (resolve, reject) => {
            let response = [];
            let transaction = this._db.transaction(["tags"], "readwrite");
            let objectStore = transaction.objectStore("tags");
            objectStore.openCursor().onsuccess = e => {
                let cursor = e.target.result;
                if( cursor ){
                    response.push(cursor.value);
                    cursor.continue();
                }
                else{
                    resolve(response);
                }
            }
        });
    }

    addTag(tagName){
        return new Promise( (resolve, reject) => {
            let addData = {
                tagName: tagName,
                contentIDs: []
            };
            let isValid = this.validateTagData(addData);
            if( isValid.result ){
                let transaction = this._db.transaction(["tags"], "readwrite");
                let objectStore = transaction.objectStore("tags");
                let request = objectStore.add(addData);
                request.onsuccess = e => {
                    this.tagCount++;
                    return this.getTag(tagName).then( e => resolve(e) );
                };
                request.onerror = e => reject(e);
            }
            else{
                reject(isValid);
            }
        });
    }

    createDateInfoNow(){
        let retDate = new Date();
        let dateStr = retDate.toLocaleDateString() + " " + retDate.toTimeString().split(' ')[0];
        return { JSON: retDate.toJSON(), Str: dateStr, Int: Date.now() }
    }

    setBookmarkData(datas){
        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["bookmarks"], "readwrite");
            let objectStore = transaction.objectStore("bookmarks");
            datas.forEach( data => {
                let textForFinding = this.genTextForFinding(data);
                let textForDuplicateCheck = this.getTextForDuplicateCheck(data);
                let addData = {
                    contents: [data.content],
                    url: data.url,
                    title: data.title,
                    header_tag_text: data.header_tag_text,
                    captions: data.captions,
                    text_for_finding: textForFinding + "\n",
                    text_for_dupcheck: textForDuplicateCheck,
                    tagIds: [],
                    clickCount: 0,
                    showCount: 0,
                    createdAt: this.createDateInfoNow(),
                    modifiedAt: null,
                    lastClickAt: null,
                    note: "",
                };
                let isValid = this.validateBookmarkData(addData);
                if( isValid.result ){
                    let request = objectStore.add(addData);
                    request.onsuccess = e => { this.bookmarkCount++; this.__keyList.unshift(e.target.result); resolve(); };
                    request.onerror = e => resolve();
                    this._incrementDataVersion();
                }
                else{
                    reject(isValid);
                }
            });
        });
    }

    updateBookmarkData(data){
        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["bookmarks"], "readwrite");
            let objectStore = transaction.objectStore("bookmarks");
            var requestUpdate = objectStore.put(data);
            requestUpdate.onerror = e => reject(e);
            requestUpdate.onsuccess = e => resolve(e);
            this._incrementDataVersion();
        });
    }

    addContentIntoBookmarkData(data){
        let transaction = this._db.transaction(["bookmarks"], "readwrite");
        let objectStore = transaction.objectStore("bookmarks");
        let index = objectStore.index("text_for_dupcheck");
        return new Promise((resolve, reject) => {
            let dupchk_text = this.getTextForDuplicateCheck(data);
            let get_item = index.get(dupchk_text);
            get_item.onsuccess = e => {
                let updateData = e.target.result;
                if( !updateData ){ reject({result: false, code: 10000}); return; }
                updateData.contents.push(data.content);
                updateData.text_for_finding += this.genTextForFinding(data) + "\n";
                updateData.modifiedAt = this.createDateInfoNow();

                let isValid = this.validateBookmarkData(updateData, false);
                if( isValid.result ){
                    var requestUpdate = objectStore.put(updateData);
                    requestUpdate.onerror = e => reject(e);
                    requestUpdate.onsuccess = e => resolve(e);
                    this._incrementDataVersion();
                }
                else{
                    reject(isValid);
                }
            }
            get_item.onerror = e => reject(e);
        });
    }

    getBookmark(key){
        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["bookmarks"], "readwrite");
            let objectStore = transaction.objectStore("bookmarks");
            let response = objectStore.get(key);
            response.onsuccess = e => {
                if( !e.target.result ) return resolve(null);
                this.attachTagDataToBookmarkData(e.target.result).then( data => resolve(data))
                                          .catch( e => reject(e) );
            };
            response.onerror = e => reject(e);
        });
    }

    attachTagDataToBookmarkDatas(bookmarks){
        let promises = [];
        bookmarks.forEach( bookmark => promises.push(this.attachTagDataToBookmarkData(bookmark)) );
        return Promise.all( promises ).then( results => Promise.resolve( results ) );
    }

    attachTagDataToBookmarkData(bookmark){
        if( !bookmark ) return Promise.reject();
        let promises = [];
        bookmark.tags = [];
        bookmark.tagIds.forEach( tagId => promises.push(this.getTagFromKey(tagId)) );
        return Promise.all( promises ).then( results=>{
            results.forEach( result => {
                bookmark.tags.push( result );
            });
            return Promise.resolve(bookmark);
        });
    }

    getBookmarks(ofs, len){
        if( ofs >= this.__keyList.length ){
            return Promise.resolve([]);
        }

        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["bookmarks"], "readwrite");
            let objectStore = transaction.objectStore("bookmarks");
            let data = [];
            let readcount = 0;
            let keyListIdxOffset = ofs + len;
            if( this.__keyList.length <= keyListIdxOffset ) keyListIdxOffset = this.__keyList.length-1;
            let offset = this.__keyList[keyListIdxOffset];
            let length = this.__keyList[ofs];

            objectStore.openCursor(IDBKeyRange.bound(offset, length), "prev").onsuccess = e => {
                var cursor = e.target.result;
                if( cursor ){
                    let ret_val = cursor.value;
                    ret_val.key = cursor.key;
                    data.push( ret_val );
                    readcount++;
                    if( (len !== 0) && (len === readcount ) ){
                        this.attachTagDataToBookmarkDatas(data).then( data => resolve(data) );
                    }
                    else{
                        cursor.continue();
                    }
                }
                else{
                    this.attachTagDataToBookmarkDatas(data).then( data => resolve(data) );
                }
            }
        });
    }

    _incrementDataVersion(){
        this._dataVersion++;
        console.log(`ver: ${this._dataVersion}`);
        chrome.storage.local.set({'version': this._dataVersion}, ()=>{});
    }

    removeBookmark(key){
        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["bookmarks"], "readwrite");
            let objectStore = transaction.objectStore("bookmarks");
            let keylistIdx = this.__keyList.indexOf(key);
            if( keylistIdx >= 0 ) this.__keyList.splice(keylistIdx, 1);
            let request = objectStore.delete(key);
            request.onsuccess = e => { this.bookmarkCount--; this._incrementDataVersion(); resolve(e);};
            request.onerror = e => reject(e);
        });
    }

    removeCode(key, index){
        return new Promise( (resolve, reject) => {
            let transaction = this._db.transaction(["bookmarks"], "readwrite");
            let objectStore = transaction.objectStore("bookmarks");
            objectStore.get(key).onsuccess = e=>{ 
                let updateData = e.target.result;
                if( (index < 0) || (index >= updateData.contents.length) ){ throw "InvalidContentIndexError" }
                if( !updateData ){ throw "Update data is nothing"; return; }
                updateData.contents.splice(index, 1);

                let arrTextforFinding = updateData.text_for_finding.split("\n");
                arrTextforFinding.splice(index, 1);
                updateData.text_for_finding = arrTextforFinding.join("\n");

                let requestUpdate = objectStore.put(updateData);
                requestUpdate.onerror = e => { throw "Update was failed" };
                requestUpdate.onsuccess = e => { resolve(e); };
                this._incrementDataVersion();
            };
        });

    }

    findUsingTagFromQueryString(query){
        let tagStrs = query.query.replace(/ |　/g, " ").split(" ");

        return Promise.all(tagStrs.map( tagStr => this.getTag(tagStr) ))
            .then( tags =>{
                tags = tags.filter( tag => tag );
                let promises = [], bmarks = [], cntProc = 0;
                tags.forEach( tag => promises = promises.concat(this.findBookmarkUsingTagPromises(tag)));
                if( promises.length == 0 ) return Promise.reject();
                return new Promise( (resolve, reject) => {
                    promises.forEach( promise => {
                        promise.then( bmark => bmarks.push(bmark) )
                        .catch( e => {} )
                        .then( e => {if( ++cntProc == promises.length ) resolve( [tags].concat(bmarks) )} );
                    });
                });
            })
            .then( params => {
                let tags = params.splice(0, 1)[0];
                let retBookmarks = [], registryBookmarkIDs = [];
                params.forEach( bookmark => {
                    if( !bookmark ) return;
                    if( (!tags.some( tag => bookmark.tagIds.indexOf(tag.id) < 0)) && (registryBookmarkIDs.indexOf(bookmark.id) < 0) ){
                        retBookmarks.push(bookmark);
                        registryBookmarkIDs.push(bookmark.id);
                    }
                })
                return Promise.resolve(retBookmarks);
            })
            .catch( e => Promise.resolve([]) );
    }

    findBookmarkUsingTagPromises(tag){
        if( !tag ) return null;
        let bmarks = [];
        tag.contentIDs.forEach( contentID => bmarks.push(this.getBookmark(contentID)));
        return bmarks;
    }

    find(query, callback){
        if( !query || query.query === "" ){
            this.getBookmarks(query.offset, query.length).then( data => callback(data) );
            return;
        }
        let searcher = new simpleSearcher();
        if( (query.query !== this.__findResults.query) || (this._dataVersion !== this.__findResults.version ) ){
            this.getAllBookmarks().then(e=>{
                let data = searcher.find(e, query.query, ["text_for_finding"]);
                this.__findResults = { query: query.query, version: this._dataVersion, data: data };
                callback( data.slice(query.offset, query.length ) );
            });
        }
        else{
            callback( this.__findResults.data.slice(query.offset, query.offset + query.length ) );
        }
    }

    getAllBookmarks(){
        return new Promise( (resolve, reject) => {
            if( this.__allDatas.version !== this._dataVersion ){
                this.getBookmarks(0, this.bookmarkCount).then( (data)=>{
                    this.__allDatas = { version: this._dataVersion, data: data };
                    resolve( data );
                    console.log("getall");
                });
            }
            else{
                resolve(this.__allDatas.data);
            }
        });
    }

    /*  --------------------------------------------------------------------------------------------------------
     *  Bookmarks / Tags Input / Output
     */

    insertTags(tags){
        if( !tags || tags.length == 0 ) return Promise.resolve({});
        return new Promise( (resolve, reject) => {
            let correspondedTags = {};
            let missingTags = [];
            let cntProc = 0;

            let chkFinishProc = () => {
                if( ++cntProc == tags.length ) resolve({ correspondedTags: correspondedTags, missingTags: missingTags});
            }

            tags.forEach( tag => {
                this.getTag(tag.tagName).then(registeredTag => {
                    if( registeredTag ){
                        correspondedTags[tag.id] = {old: tag, tag: registeredTag};
                        chkFinishProc();
                    }
                    else{
                        this.addTag(tag.tagName).then( addTag => {
                            correspondedTags[tag.id] = {old: tag, tag: addTag}
                            chkFinishProc();
                        })
                        .catch( e=>{
                            missingTags.push(tag.tagName);
                            chkFinishProc();
                        });
                    }
                });
            });
        });
    }

    getDuplicateBookmark(bookmark){
        return this.getAllBookmarks().then( bookmarks => {
            let dupBookmark = null;
            bookmarks.some( regBookmark => {
                let isEqualBookmark = regBookmark.text_for_dupcheck == bookmark.text_for_dupcheck;
                if( isEqualBookmark ) dupBookmark = regBookmark;
                return isEqualBookmark;
            });
            return Promise.resolve(dupBookmark);
        });
    }

    replaceTagID(registeredBookmark, tagList){
        if( registeredBookmark.tagIds.length == 0 ) return Promise.resolve(registeredBookmark);
        if( !tagList ) return Promise.resolve();
        let updateTagPromises = [];
        registeredBookmark.tagIds.forEach( id => {
            let setTagInfo = tagList[id];
            if( !setTagInfo ) return;
            setTagInfo.tag.contentIDs.push(registeredBookmark.id);
            updateTagPromises.push(this.updateTag(setTagInfo.tag));
        });

        return new Promise( (resolve, reject) => {
            if( updateTagPromises.length === 0 ) resolve([]);
            let setTagIds = [];
            let cntProc = 0;
            updateTagPromises.forEach( item => {
                item.then( tag => {
                    setTagIds.push( tag.id );
                    if( ++cntProc == updateTagPromises.length ){ resolve(setTagIds); }
                })
                .catch( e => { if( ++cntProc == updateTagPromises.length ){ resolve(setTagIds); }});
            });
        })
        .then( tagIds => {
            registeredBookmark.tagIds = tagIds;
            return this.updateBookmarkData(registeredBookmark);
        })
        .then( e => Promise.resolve(registeredBookmark) );
    }

    insertBookmarks(data){
        let correspondedTags = null;

        this.checkIsFillBookmarkDatabase(data.bookmark.length, true);
        this.checkIsFillTagDatabase(data.tag.length, true);

        return this.insertTags(data.tag).then( tagInfos => {
            correspondedTags = tagInfos.correspondedTags;
            return Promise.resolve(tagInfos);
        } )
        .then( e => new Promise((resolve, reject) => {
            let missingTags = e.missingTags;
            let missingData = [];
            let cntProc = 0;
            let chkFinishProc = () => {
                if( ++cntProc == data.bookmark.length ){
                    this._incrementDataVersion(); return resolve({missingDatas: missingData, missingTags: missingTags})
                }
            }

            data.bookmark.forEach( bookmark => {
                this.getDuplicateBookmark(bookmark).then( dupBookmark => {
                    if( dupBookmark ){
                        return Promise.reject(bookmark);
                    }
                    else{
                        return Promise.resolve(bookmark);
                    }
                })
                .then( setBookmark => new Promise( (resolve2, reject2) => {
                    delete setBookmark.id;
                    delete setBookmark.key;
                    let isValid = this.validateBookmarkData(setBookmark);
                    if( isValid.result ){
                        let request = this._db.transaction(["bookmarks"], "readwrite").objectStore("bookmarks").add(setBookmark);
                        request.onsuccess = e => { 
                            this.bookmarkCount++;
                            setBookmark.id = e.target.result;
                            resolve2(setBookmark);
                            this.__keyList.unshift(e.target.result);
                        };
                        request.onerror = e => reject2(setBookmark);
                    }
                    else{
                        missingData.push({item: setBookmark, error: e});
                        reject2(e);
                    }
                }))
                .then( setBookmark => this.replaceTagID(setBookmark, correspondedTags) )
                .then( e => chkFinishProc())
                .catch(e => chkFinishProc());
            });
        }))
    }
}
