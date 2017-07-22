import selection from './selection.js'
import parser from './bmark_parser.js'


var selectbox = new selection(document.body);
var bmark_parser = new parser(document.body);

var curpos = {x: 0, y: 0};

function find_element_fromcurpos(){
    let obj = document.elementFromPoint(curpos.x, curpos.y);
    let block_elem = bmark_parser.parse( obj );
    let additional_info = bmark_parser.get_information_tagsearch( block_elem );

    let send_additional_info = {};
    let header_tag_text = "";
    additional_info.forEach( (info) => {
        if( info.elements.length > 0 ){
            let elem = info.elements[0];
            let set_innertext = elem.innerText;
            send_additional_info[info.elem[0]] = {text: set_innertext, id: elem.id, class: elem.className};
            header_tag_text += set_innertext + "<,>";
        }
    });
    header_tag_text = header_tag_text.substr(0, header_tag_text.length-3);

    return {
                block: block_elem.innerText,
                title: document.title,
                url: window.location.href,
                header_tag_text: header_tag_text,
                tags: send_additional_info
           };
}

function handler_mousemove(e){
    curpos.x = e.clientX;
    curpos.y = e.clientY;
}

function jump_link(url){
    window.location.href = url;
}

document.addEventListener("contextmenu", handler_mousemove, false);

chrome.runtime.onMessage.addListener( function(request, sender, sendResponse) {
    console.log(request);
    switch( request.id ){
        case "element_memo":
            sendResponse(find_element_fromcurpos());
            break;

        case "jump_link":
            jump_link(request.url);
            break;

        default:
            sendResponse();
    }
});



