/*******************************************************************************

    httpswitchboard - a Chromium browser extension to black/white list requests.
    Copyright (C) 2013  Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/httpswitchboard
*/

// ORDER IS IMPORTANT

/******************************************************************************/

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    // Can this happen?
    if ( !tab.url || !tab.url.length ) {
        return;
    }
    // console.debug('tabs.onUpdated > tabId=%d changeInfo=%o tab=%o', tabId, changeInfo, tab);
    if ( getUrlProtocol(tab.url).search('http') !== 0 ) {
        return;
    }
    // Ensure we have a url stats store and that the tab is bound to it.
    bindTabToUrlstatsStore(tab.id, tab.url);

    // Following code is for script injection, which makes sense only if
    // web page in tab is completely loaded.
    if ( changeInfo.status !== 'complete' ) {
        return;
    }
    // Chrome webstore can't be injected with foreign code (I can see why),
    // following is to avoid error message.
    if ( tab.url.search(/^https?:\/\/chrome\.google\.com\/webstore\//) === 0 ) {
        return;
    }
    // Check if page has at least one script tab. We must do that here instead
    // of at web request intercept time, because we can't inject code at web
    // request time since the url hasn't been set in the tab.
    // TODO: For subframe though, we might need to do it at web request time.
    //       Need to investigate using trace, doc does not say everything.
    // console.debug('tabs.onUpdated > injecting code to check for at least one <script> tag');
    chrome.tabs.executeScript(
        tabId,
        {
            file: 'js/inject.js',
            runAt: 'document_idle'
        },
        function(r) {
            if ( r ) {
                var domain = getUrlDomain(tab.url);
                record(tabId, 'script', tab.url);
                if ( blacklisted('script', domain) ) {
                    addTabState(tabId, 'script', domain);
                }
            }
        }
    );
})

/******************************************************************************/

// Load user settings

load();

/******************************************************************************/

// Initialize internal state with maybe already existing tabs

(function(){
    chrome.tabs.query({ url: '<all_urls>' }, function(tabs) {
        var i = tabs.length;
        // console.debug('HTTP Switchboard > preparing to bind %d tabs', i);
        var tab;
        while ( i-- ) {
            tab = tabs[i];
            bindTabToUrlstatsStore(tab.id, tab.url);
        }
        // Tabs are now bound to url stats stores, therefore it is now safe
        // to handle net traffic.
        chrome.runtime.sendMessage({
            'what': 'startWebRequestHandler',
            'from': 'tabsBound'
            });
    });
})();

/******************************************************************************/

// hooks to let popup let us know whether page must be reloaded

chrome.extension.onConnect.addListener(function(port) {
    port.onMessage.addListener(function(){});
    port.onDisconnect.addListener(function() {
        chrome.tabs.query({ status: 'complete' }, function(chromeTabs){
            var tabId;
            for ( var i = 0; i < chromeTabs.length; i++ ) {
                tabId = chromeTabs[i].id;
                if ( tabExists(tabId) ) {
                    smartReloadTab(tabId);
                }
            }
        });
    });
});

/******************************************************************************/

// Garbage collect stale url stats entries

(function(){
    var httpsb = HTTPSB;
    var gcFunc = function() {
        chrome.tabs.query({ 'url': '<all_urls>' }, function(tabs){
            var url;
            for ( var i = 0; i < tabs.length; i++ ) {
                url = tabs[i].url;
                if ( httpsb.urls[url] ) {
                    httpsb.urls[url].lastTouched = Date.now();
                }
            }
            var interval;
            for ( url in httpsb.urls ) {
                interval = Date.now() - httpsb.urls[url].lastTouched;
                if ( interval < httpsb.gcPeriod ) {
                    // console.debug('GC > last touched %d ms ago, can\'t dispose of "%s"', interval, url);
                    continue;
                }
                // console.debug('GC > disposed of "%s"', url);
                delete httpsb.urls[url];
            }
        });
    };

    setInterval(gcFunc, httpsb.gcPeriod / 2);
})();
