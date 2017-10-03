const database = require("./database");
const bcrypt = require('bcrypt');                         // encrypt passwords

const commonPasswords = ["123456", "password", "password1", "password123", "password321", "123456", "654321", "12345678", "87654321", "football", "qwerty", "1234567890", "1234567", "princess"]


function search(db, req, callback){


	searchQuery = {
		name: {
			$regex: RegExp(req.body.term),
			$options: 'i'
		}
	}

	database.read(db, "terms", searchQuery, function(searchResult){

		console.log(searchResult);

		callback({
			status: "success",
			count: searchResult.length,
			body: searchResult
		});

	});
}

function getDefinitions(db, req, callback){


	searchQuery = {
		term: req.body.term
	}

	database.read(db, "definitions", searchQuery, function(searchResult){

		console.log(searchResult);

		var responsesToReturn = [];

		searchResult.forEach(function(oneResult){
			if(!oneResult.removed && oneResult.approved){
				responsesToReturn.push(oneResult);
			}
		})

		callback({
			status: "success",
			count: responsesToReturn.length,
			body: responsesToReturn
		});

	});
}

function addDefinition(db, req, callback){
	if(req.session.user){
		if(req.body.definition && req.body.term){

			var userSubmissionsQuery = {
				author: req.session.user.username,
				approved: true
			}

			database.read(db, "definitions", userSubmissionsQuery, function fetchUser(approvedDefinitions){

				console.log("This user has submitted " + approvedDefinitions.length + " definitions");

				newDefinitionQuery = {
					id: Math.floor(Date.now()/Math.random()),							// hopefully this should give us a random ID
					term: req.body.term.trim().toLowerCase(),
					author: req.session.user.username,
					upvotes: 0,
					downvotes: 0, 
					reportCount: 0,
					removed: false,
					approved: false,
					rejected: false,
					lastEdit: Date(),
					created: Date(),
					body: req.body.definition,
					related: []
				}

				if(approvedDefinitions.length > 5){
					console.log("Auto approve based on positive submission history");
					newDefinitionQuery.approved = true
				}



				termQuery = { 
					name: req.body.term
				}

				database.read(db, "terms", termQuery, function checkForExistingTerm(existingTerms){

					if(existingTerms.length == 0){
						console.log("creating new definition for the term '" + termQuery.name + "'");
						database.create(db, "terms", termQuery, function createdTerm(newTerm){
							database.create(db, "definitions", newDefinitionQuery, function createdDefinition(newDefinition){
								console.log(newDefinition.ops[0]);
								callback({
									status: "success",
									term: newDefinition.ops[0].term
								});
							});
						});
					} else if (existingTerms.length == 1) {
						console.log("Someone has already created the term '" + termQuery.name + "'");
						database.create(db, "definitions", newDefinitionQuery, function createdDefinition(newDefinition){
							console.log(newDefinition.ops[0]);
							callback({
								status: "success",
								term: newDefinition.ops[0].term
							});
						});
					} else {
						console.log("Multiple definitions for one term");
						callback({
							status: "fail",
							message: "Multiple definitions for one term"
						});
					}
				})



			})

			
		} else {
			callback({
				status: "fail",
				message: "A new post must have a term and a definition."
			});
		}
	} else {
		callback({
			status: "fail",
			message: "You must log in to add a definition"
		});
	}
}


function vote(db, req, callback){

	/* 
		1. check if there's already a vote for this user for this term
		2. if there is, remove it, and create a new one (easier than changing type)
		3. if there isn't, create the vote
		4. update term
	*/


	var voter;

	if(req.session.user){
		voter = req.session.user.username
	} else {
		voter = req.headers["X-Forwarded-For"] || req.headers["x-forwarded-for"] || req.client.remoteAddress;
	}


	var voteQuery = {
		post: parseInt(req.body.id),
		author: voter
	}

	var newVote = {
			post: parseInt(req.body.id),
			author: voter,
			type: req.body.type,
			date: Date()
		}

	database.read(db, "votes", voteQuery, function checkForExistingVote(existingVotes){

		console.log("Existing votes");

		console.log(existingVotes);
		console.log("=========");

		if(existingVotes.length == 0){
			console.log("no votes")
			createNewVote(db, req, newVote, callback);
		} else if (existingVotes.length == 1){

			console.log("one vote");

			if(existingVotes[0].type != newVote.type){

				// if vote already recorded in a different direction, remove it and create a new one in the right direction (ex: remove upvote, create downvote)

				database.remove(db, "votes", voteQuery, function removeVote(removedVote){

					var voteChange;

					if(newVote.type == "up"){
						voteChange = "downvotes";
					} else {
						voteChange = "upvotes"
					}

					var definitionQuery = {
						id: voteQuery.post
					}

					var definitionUpdateQuery = {
						$inc: {}
					};

					definitionUpdateQuery.$inc[voteChange] = -1;

					database.update(db, "definitions", definitionQuery, definitionUpdateQuery, function updateDefinition(newDefinition){
						createNewVote(db, req, newVote, callback);
					})
				})

			} else {
				// if vote already recorded, remove it (if upvoting after already upvoting, remove upvote)
				console.log("vote already recorded");
				database.remove(db, "votes", voteQuery, function removeVote(removedVote){

					var voteChange = newVote.type + "votes";

					var definitionQuery = {
						id: voteQuery.post
					}

					var definitionUpdateQuery = {
						$inc: {}
					};

					definitionUpdateQuery.$inc[voteChange] = -1;

				
					database.update(db, "definitions", definitionQuery, definitionUpdateQuery, function updateDefinition(newDefinition){
						callback({status: "success", message: "vote created"});
					})
				})
			}
			
		} else {
			callback({status: "fail", message: "Something went wrong"});
		}
	});


}

function createNewVote(db, req, newVote, callback){

	database.create(db, "votes", newVote, function createVote(newVote){

		var voteChange

		if(newVote.ops[0].type == "up"){
			voteChange = "upvotes";
		} else {
			voteChange = "downvotes"
		}

		var definitionQuery = {
			id: newVote.ops[0].post
		}

		var definitionUpdateQuery = {
			$inc: {}
		};

		definitionUpdateQuery.$inc[voteChange] = 1;

		console.log("definitionUpdateQuery");
		console.log(definitionUpdateQuery);

		database.update(db, "definitions", definitionQuery, definitionUpdateQuery, function updateDefinition(newDefinition){
			callback({status: "success", message: "vote created"});
		})	
	})
}


function adminVote(db, req, callback){

	if(req.body.post == "definition"){

		var definitionQuery = {
			id: parseInt(req.body.id)
		}

		var definitionUpdateQuery = {
			$set: {}
		}

		if(req.body.type == "approved" || req.body.type == "rejected"){
			definitionUpdateQuery.$set[req.body.type ] = true;
		}

		database.update(db, "definitions", definitionQuery, definitionUpdateQuery, function updateDefinition(response){
			callback({status: "success", message: "definition updated"});
		})

	} else if (req.body.post == "report"){
		callback({status: "success", message: "Something went wrong"});
	} else {
		callback({status: "fail", message: "Something went wrong"});
	}









}


function signup(db, req, callback){
	console.log(req.body);

	if(req.body.username.trim().length && req.body.password.trim().length){    	// let's make sure the username and password aren't empty
		if(req.body.username.trim().length && req.body.password.trim().length > 5){    
			if(req.body.username.replace(/\s/g, '').length == req.body.username.length){
				if(commonPasswords.indexOf(req.body.password.trim()) == -1){
					bcrypt.genSalt(10, function(err, salt) {
					    bcrypt.hash(req.body.password, salt, function(err, hash) {
					   		var newUser = {
					   			username: req.body.username.toLowerCase(),
					            password: hash,
					            lastLoggedOn: Date(),
					            suspended: false,
					            admin: false,
					            moderator: false,
					   			data: {
					   				username: req.body.username.toLowerCase(),
					   				newNotifications: false 
					   			}
					            
					        }

							var userQuery = {
								username: newUser.username,
							}

							database.read(db, "users", userQuery, function(existingUsers){
								if(existingUsers.length == 0){																		
									database.create(db, "users", newUser, function(newlyCreatedUser){
										callback({status: "success", message: "Account created. Go ahead and log in!", user: newlyCreatedUser[0]})
									});
								} else {	
									callback({status: "fail", message: "That username is not available"})
								}
							})     
					    });
					});
				} else {
					callback({status: "fail", message: "Do you want to get hacked? Because that's how you get hacked."});
				}
			} else {
				callback({status: "fail", message: "No spaces in the username, please"});
			}
		} else {
			callback({status: "fail", message: "Password must be 6 characters or longer"});
		}
	} else {
		callback({status: "fail", message: "Username an password can't be blank"})
	}
}

function login(db, req, callback){
	if(req.body.username.trim().length && req.body.password.trim().length){    	// let's make sure the username and password aren't empty 

		console.log(req.body);

		var userQuery = {
            username: req.body.username.toLowerCase(),
        }	

		database.read(db, "users", userQuery, function checkIfUserExists(existingUsers){
			if(existingUsers.length == 1){	
				bcrypt.compare(req.body.password, existingUsers[0].password, function(err, res) {
					if(res){													// if the two password hashes match...
						if(!existingUsers[0].suspended){

							var loginDateUpdate = {
								$set: {
									lastLoggedOn: Date()
								}
							}

							database.update(db, "users", userQuery, loginDateUpdate, function updateLastLogin(lastLogin){
								console.log("Logged in successfully.")
								console.log(existingUsers[0].data);
				                req.session.user = existingUsers[0].data;
				                req.session.user.admin = existingUsers[0].admin;
				                var day = 60000*60*24;
				                req.session.expires = new Date(Date.now() + (30*day));          // this helps the session keep track of the expire date
				                req.session.cookie.maxAge = (30*day);                           // this is what makes the cookie expire
				                callback({status: "success", message: "Logged in"});
							})
						} else {
							req.session.user = null;
							callback({status: "fail", message: "Your account has been suspended."})
						}
					} else {
						req.session.user = null;
						callback({status: "fail", message: "Login or password are incorrect"})
					}
				});										
			} else {
				req.session.user = null;
				callback({status: "fail", message: "Login or password are incorrect"})
			}
		});

	} else {
		callback({status: "fail", message: "Name is blank"})
	}
}


function getAdminData(db, req, callback){
	if(req.session.user.admin){    	// let's make sure the username and password aren't empty 

		unapprovedDefinitionsQuery = {
			approved: false,
			rejected: false
		}

		unresolvedReportsQuery = {
			approved: false
		}

		database.read(db, "definitions", unapprovedDefinitionsQuery, function getUnapprovedDefinitions(unapprovedDefinitions){
			database.read(db, "reports", {}, function getUnresolvedReports(unresolvedReports){
				callback({definitions: unapprovedDefinitions, reports: unresolvedReports})
			})
		})
		
	} else {
		callback({status: "fail", message: "Not an admin"})
	}
}





/* NON-DB FUNCTIONS */

function generateHash(hashLength){
	var chars = "abcdefghijklmnopqrstuvwxyz1234567890"
    var hash = "";

    for (var i = 0; i < hashLength ; i++){
    	hash += chars[Math.floor(Math.random()*chars.length)]
    }

    return hash;
}

/* MODULE EXPORES */
module.exports.search = search;
module.exports.getDefinitions = getDefinitions;
module.exports.addDefinition = addDefinition;
module.exports.vote = vote;
module.exports.generateHash = generateHash;

module.exports.signup = signup;
module.exports.login = login;

module.exports.getAdminData = getAdminData;
module.exports.adminVote = adminVote;