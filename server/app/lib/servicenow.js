/*
Copyright [2016] [Relevance Lab]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/


var Client = require('node-rest-client').Client;
var logger = require('_pr/logger')(module);
var mongoose = require('mongoose');
var request = require('request');
var ObjectId = require('mongoose').Types.ObjectId;
var masterUtil = require('../lib/utils/masterUtil.js');

var CMDBConfigSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        trim: true
    },
    configname: {
        type: String,
        required: true,
        trim: true,
        //validate: nameValidator
    },
    url: {
        type: String,
        required: true,
        trim: true
    },
    servicenowusername: {
        type: String,
        required: true,
        trim: true,
        //validate: nameValidator
    },
    servicenowpassword: {
        type: String,
        required: true,
        trim: true
    },
    orgname: {
        type: [String],
        required: true,
        trim: true,
        //validate: nameValidator
    },
    orgname_rowid: {
        type: [String],
        required: true,
        trim: true
    },
    rowid: {
        type: String,
        required: true,
        trim: true
    }
});

CMDBConfigSchema.methods.postCatalogitem = function(blueprintData, postData, callback) {
    var username = CMDBConfigSchema.servicenowusername;
    var password = CMDBConfigSchema.servicenowpassword;
    var tmp = CMDBConfigSchema.url;
    var host = tmp.replace(/.*?:\/\//g, "");
    var url = host.split('/');
    var requestURL = 'https://' + url[0] + '/api/now/table/sc_cat_item';
    var requestBody = {
        "name": blueprintData.name,
        "category": "37fc53ecdb3e52008dc05c00cf9619ed",
        "sc_catalogs": "1fdc5bacdb3e52008dc05c00cf9619cc",
        "short_description": blueprintData.name + " is availbale.Blueprint-Id -( " + blueprintData._id + " )",
        "workflow": "8fb38946db2212008dc05c00cf96197a",
        "active": "true"
    };
    var options = {
        url: requestURL,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            "Authorization": "Basic " + new Buffer(username + ":" + password).toString('base64')
        },
        'body': requestBody,
        'json': true

    };
    request(options, function(error, response, body) {
        if (!error && response.statusCode == 201) {
            logger.debug("success", JSON.stringify(body));
            masterUtil.getParticularProject(blueprintData.projectId, function(err, envID) {
                if (err) {
                    logger.debug("Environment not found");
                }
                logger.debug("Env Id======>", JSON.stringify(envID));
            });
        } else {
            logger.error("Error", error);
        }
    });
};

CMDBConfigSchema.methods.catalogItemVarriable = function(catalogData, callback) {
    var username = postData[0].servicenowusername;
    var password = postData[0].servicenowpassword;
    var tmp = postData[0].url;
    var host = tmp.replace(/.*?:\/\//g, "");
    var url = host.split('/');
    var requestURL = 'https://' + url[0] + '/api/now/table/item_option_new';
    var requestBody = {
        "cat_item": "af3ae055dbf292008dc05c00cf961998",
        "default_value": "DEV",
        "choice_direction": "down",
        "active": "true",
        "name": "env_type",
        "question_text": "Select Environment",
        "type": "3"
    };
    // var options = {
    //     url: requestURL,
    //     method: 'POST',
    //     headers: {
    //         'Content-Type': 'application/json',
    //         'Accept': 'application/json',
    //         "Authorization": "Basic " + new Buffer(username + ":" + password).toString('base64')
    //     },
    //     'body': requestBody,
    //     'json': true

    // };
    // request(options, function(error, response, body) {
    //     if (!error && response.statusCode == 201) {
    //         logger.debug("success", JSON.stringify(body));
    //         masterUtil.getParticularProject(blueprintData.projectId, function(err, envID) {
    //             if (err) {
    //                 logger.debug("Environment not found");
    //             }
    //             logger.debug("Env Id======>", JSON.stringify(envID));
    //         });
    //     } else {
    //         logger.error("Error", error);
    //     }
    // });
};


CMDBConfigSchema.statics.getCMDBServerById = function(serverId, callback) {

    logger.debug("START :: getCMDBServerById ");
    logger.debug("Servcer Id:", serverId);

    this.findOne({
        _id: serverId
    }, function(err, data) {
        if (err) {
            logger.error("Failed getServiceNow Config by Id", err);
            callback(err, null);
            return;
        }
        callback(null, data);
    });
}

CMDBConfigSchema.statics.getConfigItems = function(tableName, options, callback) {
    logger.debug("START :: getConfigItems");

    var basic_auth = {
        user: options.username,
        password: options.password
    };

    var tmp = options.host;
    var host = tmp.replace(/.*?:\/\//g, "");

    var servicenowURL = 'https://' + options.username + ':' + options.password + '@' + host + '/api/now/table/' + tableName;
    var options = {
        url: servicenowURL,
        headers: {
            'User-Agent': 'request',
            'Accept': 'application/json'
        }
    };

    logger.debug("options", options);

    request(options, function(error, response, body) {
        //logger.debug("response.statusCode", response.statusCode);
        if (!error && response.statusCode == 200) {
            logger.debug("success");
            var info = JSON.parse(body);
            callback(null, info);

        } else {
            logger.error("Error");
            callback("Error in getting CMDB data", null);
        }
    });
}

CMDBConfigSchema.statics.getCMDBList = function(callback) {
    this.find({
        id: "90"
    }, function(err, data) {
        if (err) {
            logger.error(err);
            callback(err, null);
            return;
        }
        callback(null, data);

    });
}

CMDBConfigSchema.statics.saveConfig = function(config, callback) {
    var configObj = config;
    var that = this;
    var obj = that(configObj);

    obj.save(function(err, data) {
        if (err) {
            logger.error(err);
            callback(err, null);
            return;
        }
        logger.debug("Exit createNew CMDB configuration");
        callback(null, data);
        return;
    })

}

CMDBConfigSchema.statics.removeServerById = function(serverId, callback) {
    this.remove({
        "rowid": serverId
    }, function(err, data) {
        if (err) {
            logger.error("Failed to remove item (%s)", err);
            callback(err, null);
            return;
        }
        logger.debug("Exit removeInstancebyId (%s)", serverId);
        callback(null, data);
    });
}

CMDBConfigSchema.statics.getConfigItemByName = function(name, tableName, options, callback) {
    logger.debug("START getConfigItemByName..");

    this.getConfigItems(tableName, options, function(err, data) {

        for (i = 0; i < data.result.length; i++) {
            if (data.result[i].name == name) {
                logger.debug("Node found >>>", data.result[i]);
                callback(null, data.result[i]);
                return;
            }

        }
        callback({
            erroMsg: "Selected Node not found"
        }, null);

        return;
    });
}

CMDBConfigSchema.statics.updateConfigItemById = function(configData, callback) {

    logger.debug("Enter updateConfigItemById");
    this.update({
        "_id": new ObjectId(configData._id)
    }, {
        $set: {
            configname: configData.configname,
            url: configData.url,
            servicenowusername: configData.servicenowusername,
            servicenowpassword: configData.servicenowpassword,
            orgname: configData.orgname
        }
    }, {
        upsert: false
    }, function(err, updateCount) {
        if (err) {
            logger.debug("Exit updateConfigItemById with no update.");
            callback(err, null);
            return;
        }
        logger.debug("Exit updateConfigItemById with update success.");
        callback(null, updateCount);
        return;

    });

}

var CMDBConfig = mongoose.model('CMDBConfig', CMDBConfigSchema);

module.exports = CMDBConfig;